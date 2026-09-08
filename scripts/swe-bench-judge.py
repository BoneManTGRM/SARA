"""Judge-only frozen-patch evaluation. Never import this into a model producer."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location("pilot", Path(__file__).with_name("swe-bench-pilot.py"))
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


def validate_request(request, tasks):
    required = {"schemaVersion", "instanceId", "arm", "runId", "patch", "patchDigest", "environmentDigest", "taskDigest", "image", "repository", "baseCommit", "fixtureProxyImage"}
    if set(request) != required or request["schemaVersion"] != 1:
        raise ValueError("JUDGE_REQUEST_SCHEMA")
    if request["arm"] not in ("conventional", "reparodynamic"):
        raise ValueError("JUDGE_ARM")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", request["runId"]):
        raise ValueError("JUDGE_RUN_ID")
    for field in ("patchDigest", "environmentDigest", "taskDigest"):
        if not re.fullmatch(r"[a-f0-9]{64}", request[field]):
            raise ValueError("JUDGE_DIGEST")
    if not isinstance(request["patch"], str) or len(request["patch"].encode()) > 1024 * 1024:
        raise ValueError("JUDGE_PATCH_SIZE")
    if pilot.digest(request["patch"].encode()) != request["patchDigest"]:
        raise ValueError("JUDGE_PATCH_MISMATCH")
    matches = [row for row in tasks if row["instance_id"] == request["instanceId"]]
    if len(matches) != 1:
        raise ValueError("JUDGE_INSTANCE")
    if request["repository"] != matches[0]["repo"] or request["baseCommit"] != matches[0]["base_commit"]:
        raise ValueError("JUDGE_PRODUCER_BASE_MISMATCH")
    if request["fixtureProxyImage"] is not None:
        if (request["instanceId"] != "axios__axios-5085" or
                not re.fullmatch(r"python@sha256:[a-f0-9]{64}", request["fixtureProxyImage"])):
            raise ValueError("JUDGE_FIXTURE_POLICY")
    expected = matches[0]["image"].rsplit(":", 1)[0] + "@sha256:"
    if not request["image"].startswith(expected) or not re.fullmatch(r"[a-f0-9]{64}", request["image"][len(expected):]):
        raise ValueError("JUDGE_IMAGE_IDENTITY")
    return matches[0]


class CheckedContainer:
    def __init__(self, container, base_commit, fixture=None):
        self.container, self.base_commit = container, base_commit
        self.fixture = fixture

    def __getattr__(self, name):
        return getattr(self.container, name)

    def start(self):
        self.container.start()
        if self.fixture:
            self.fixture.verify_judge_network(self.container)
        diagnostics = {}
        for name, command in {
            "identity": ["id"], "hosts": ["cat", "/etc/hosts"],
            "lookup": ["getent", "ahostsv4", "localhost"],
            "nsswitch": ["cat", "/etc/nsswitch.conf"],
        }.items():
            result = self.container.exec_run(command, workdir="/testbed")
            diagnostics[name] = {"exitCode": result.exit_code,
                                 "output": result.output.decode(errors="replace")[:4000]}
        Path("startup-diagnostics.json").write_text(json.dumps(diagnostics, indent=2))
        # The pinned image may belong to its build user. Trust only this exact
        # container path, as the stock eval script does later, never all paths.
        git = ["git", "-c", "safe.directory=/testbed"]
        head = self.container.exec_run(git + ["rev-parse", "HEAD"], workdir="/testbed")
        clean = self.container.exec_run(git + ["status", "--porcelain", "--untracked-files=no"], workdir="/testbed")
        if clean.exit_code == 0 and clean.output.strip():
            initial_diff = self.container.exec_run(git + ["diff", "--no-ext-diff", "--no-textconv", "HEAD"], workdir="/testbed")
            if initial_diff.exit_code or len(initial_diff.output) > 1024 * 1024:
                raise ValueError("JUDGE_INITIAL_DIFF_UNAVAILABLE")
            Path("image-tracked-diff.diff").write_bytes(initial_diff.output)
        # This pinned Preact image has an install-generated lockfile change.
        # Restore only that observed metadata file before any submitted patch;
        # retain the original diff and still demand a completely clean base.
        if (self.base_commit == "00c8d1ff1498084c15408cf0014d4c7facdb5dd7"
                and head.exit_code == 0 and head.output.decode().strip() == self.base_commit
                and clean.exit_code == 0 and clean.output == b" M package-lock.json\n"):
            original = self.container.exec_run(git + ["diff", "HEAD", "--", "package-lock.json"], workdir="/testbed")
            if original.exit_code:
                raise ValueError("JUDGE_LOCKFILE_DIAGNOSTIC_FAILED")
            Path("image-lockfile-normalization.diff").write_bytes(original.output)
            restored = self.container.exec_run(git + ["restore", "--source=" + self.base_commit,
                                                      "--worktree", "--", "package-lock.json"], workdir="/testbed")
            if restored.exit_code:
                raise ValueError("JUDGE_LOCKFILE_NORMALIZATION_FAILED")
            clean = self.container.exec_run(git + ["status", "--porcelain", "--untracked-files=no"], workdir="/testbed")
        # The Docusaurus image's Corepack setup adds only packageManager.
        # Bind normalization to the exact observed diff, not arbitrary manifests.
        if (self.base_commit == "0589b1475d56b0b541348aa56f201ec7c56c56d5"
                and head.exit_code == 0 and head.output.decode().strip() == self.base_commit
                and clean.exit_code == 0 and clean.output == b" M package.json\n"
                and hashlib.sha256(initial_diff.output).hexdigest() == "c01754d90bb5c2b79bb20813bbe95895999eaa68aa56b0ae62e6c70f75197e18"):
            Path("image-package-manager-normalization.diff").write_bytes(initial_diff.output)
            restored = self.container.exec_run(git + ["restore", "--source=" + self.base_commit,
                                                      "--worktree", "--", "package.json"], workdir="/testbed")
            if restored.exit_code:
                raise ValueError("JUDGE_PACKAGE_MANAGER_NORMALIZATION_FAILED")
            clean = self.container.exec_run(git + ["status", "--porcelain", "--untracked-files=no"], workdir="/testbed")
        if head.exit_code or head.output.decode().strip() != self.base_commit or clean.exit_code or clean.output.strip():
            raise ValueError("JUDGE_IMAGE_BASE_MISMATCH:" + json.dumps({
                "headExitCode": head.exit_code, "head": head.output.decode(errors="replace")[:1000],
                "statusExitCode": clean.exit_code, "status": clean.output.decode(errors="replace")[:4000]}))


class RestrictedContainers:
    def __init__(self, containers, base_commit, run_id, fixture=None):
        self.containers = containers
        self.base_commit = base_commit
        self.run_id = run_id
        self.fixture = fixture

    def __getattr__(self, name):
        return getattr(self.containers, name)

    def create(self, **kwargs):
        if any(kwargs.get(key) for key in ("volumes", "mounts", "devices", "environment", "privileged")):
            raise ValueError("JUDGE_UNSAFE_CONTAINER_REQUEST")
        # The official grader requests SYS_ADMIN. Remove it; qualify compatible
        # tasks with the same official parser/tests and retain incompatibilities.
        kwargs.update(network_disabled=False, network_mode="none", cap_add=[], cap_drop=["ALL"],
                      security_opt=["no-new-privileges"], mem_limit="2g", memswap_limit="2g",
                      nano_cpus=2_000_000_000, pids_limit=256,
                      labels={"sara.repositoryJudgeRun": self.run_id},
                      extra_hosts={"localhost": "127.0.0.1"})
        if self.fixture:
            kwargs.update(self.fixture.judge_options())
        return CheckedContainer(self.containers.create(**kwargs), self.base_commit, self.fixture)


class RestrictedClient:
    def __init__(self, client, base_commit, run_id, fixture=None):
        self.client = client
        self.containers = RestrictedContainers(client.containers, base_commit, run_id, fixture)

    def __getattr__(self, name):
        return getattr(self.client, name)


def grade(request, dataset, manifest_path, harness, output):
    frozen = json.loads(manifest_path.read_text())
    selected = validate_request(request, frozen["tasks"])
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    receipt = {"schemaVersion": 1, "instanceId": request["instanceId"], "arm": request["arm"],
               "runId": request["runId"], "patchDigest": request["patchDigest"],
               "environmentDigest": request["environmentDigest"], "taskDigest": request["taskDigest"],
               "image": request["image"], "harnessRevision": pilot.HARNESS_REVISION,
               "fixtureProxyImage": request["fixtureProxyImage"],
               "repository": request["repository"], "baseCommit": request["baseCommit"],
               "datasetSha256": pilot.DATASET_SHA256, "resolved": False, "gradeCompleted": False,
               "containerPolicy": "network-none-cap-drop-all-2cpu-2g-256pids", "modelRequests": 0}
    previous = Path.cwd()
    fixture = None
    try:
        actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=harness, text=True).strip()
        dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=harness, text=True).strip()
        if actual != pilot.HARNESS_REVISION or dirty:
            raise ValueError("JUDGE_HARNESS_SOURCE")
        rows = pilot.load_rows(dataset)
        if pilot.manifest(rows) != frozen:
            raise ValueError("JUDGE_SELECTION_DRIFT")
        row = next(row for row in rows if row["instance_id"] == selected["instance_id"])
        sys.path.insert(0, str(harness.resolve()))
        import docker
        from swebench.harness.run_evaluation import run_instance
        from swebench.harness.utils import make_test_spec
        from swebench.harness.grading import get_logs_eval
        # Detect an installed module from a different checkout despite the Git pin.
        import swebench.harness.run_evaluation as evaluation
        if not Path(evaluation.__file__).resolve().is_relative_to(harness.resolve()):
            raise ValueError("JUDGE_IMPORTED_HARNESS_MISMATCH")
        raw_client = docker.from_env()
        if request["fixtureProxyImage"]:
            runtime_spec = importlib.util.spec_from_file_location("fixture_runtime", Path(__file__).with_name("swe-judge-fixture-runtime.py"))
            runtime = importlib.util.module_from_spec(runtime_spec)
            runtime_spec.loader.exec_module(runtime)
            fixture = runtime.FixtureRuntime(raw_client, request["runId"], request["fixtureProxyImage"], output)
            fixture.start()
            receipt.update(containerPolicy="internal-network-fixed-postman-get-proxy-cap-drop-all-2cpu-2g-256pids",
                           fixtureProxyImageId=fixture.image_id,
                           fixtureProxySourceDigest=pilot.digest(Path(__file__).with_name("swe-judge-fixture-proxy.py").read_bytes()))
        client = RestrictedClient(raw_client, row["base_commit"], request["runId"], fixture)
        image = client.images.pull(request["image"])
        receipt["imageId"] = image.id
        test_spec = make_test_spec(row)
        test_spec.image = image.id
        prediction = {"instance_id": row["instance_id"], "model_name_or_path": "sara-frozen-" + request["arm"], "model_patch": request["patch"]}
        os.chdir(output)
        result = run_instance(test_spec, prediction, client, request["runId"], timeout=900,
                              skip_patch=(request["patch"] == ""))
        report = result[1][row["instance_id"]] if result else None
        report_path = Path("logs/evaluation") / request["runId"] / prediction["model_name_or_path"] / row["instance_id"] / "report.json"
        if not isinstance(report, dict) or not report_path.is_file():
            raise ValueError("JUDGE_MISSING_REPORT")
        log = report_path.with_name("test_output.txt")
        statuses, found = get_logs_eval(test_spec, log) if log.is_file() else ({}, False)
        receipt["expectedFailureObserved"] = bool(found and any(statuses.get(test) in ("FAILED", "ERROR") for test in test_spec.FAIL_TO_PASS))
        receipt["passToPassRegressionCount"] = len(report.get("tests_status", {}).get("PASS_TO_PASS", {}).get("failure", []))
        receipt.update(gradeCompleted=True, resolved=report.get("resolved") is True,
                       reportRelativePath=str(report_path), reportDigest=pilot.digest(report_path.read_bytes()))
    except Exception as error:
        receipt["error"] = type(error).__name__ + ": " + str(error)[:1000]
    finally:
        os.chdir(previous)
        if fixture:
            try:
                fixture.close()
            except Exception as error:
                receipt.update(resolved=False, gradeCompleted=False, error="FIXTURE_CLEANUP_FAILED:" + str(error)[:500])
        receipt["elapsedMilliseconds"] = round((time.monotonic() - started) * 1000)
        pilot.write_json(output / "judge-receipt.json", receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("request", "dataset", "manifest", "harness", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text())
    receipt = grade(request, args.dataset.resolve(), args.manifest.resolve(), args.harness.resolve(), args.output.resolve())
    print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt["gradeCompleted"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
