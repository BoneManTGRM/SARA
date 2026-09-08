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
    required = {"schemaVersion", "instanceId", "arm", "runId", "patch", "patchDigest", "environmentDigest", "taskDigest", "image", "repository", "baseCommit"}
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
    expected = matches[0]["image"].rsplit(":", 1)[0] + "@sha256:"
    if not request["image"].startswith(expected) or not re.fullmatch(r"[a-f0-9]{64}", request["image"][len(expected):]):
        raise ValueError("JUDGE_IMAGE_IDENTITY")
    return matches[0]


class CheckedContainer:
    def __init__(self, container, base_commit):
        self.container, self.base_commit = container, base_commit

    def __getattr__(self, name):
        return getattr(self.container, name)

    def start(self):
        self.container.start()
        # The pinned image may belong to its build user. Trust only this exact
        # container path, as the stock eval script does later, never all paths.
        git = ["git", "-c", "safe.directory=/testbed"]
        head = self.container.exec_run(git + ["rev-parse", "HEAD"], workdir="/testbed")
        clean = self.container.exec_run(git + ["status", "--porcelain", "--untracked-files=no"], workdir="/testbed")
        if head.exit_code or head.output.decode().strip() != self.base_commit or clean.exit_code or clean.output.strip():
            raise ValueError("JUDGE_IMAGE_BASE_MISMATCH:" + json.dumps({
                "headExitCode": head.exit_code, "head": head.output.decode(errors="replace")[:1000],
                "statusExitCode": clean.exit_code, "status": clean.output.decode(errors="replace")[:4000]}))


class RestrictedContainers:
    def __init__(self, containers, base_commit, run_id):
        self.containers = containers
        self.base_commit = base_commit
        self.run_id = run_id

    def __getattr__(self, name):
        return getattr(self.containers, name)

    def create(self, **kwargs):
        if any(kwargs.get(key) for key in ("volumes", "mounts", "devices", "environment", "privileged")):
            raise ValueError("JUDGE_UNSAFE_CONTAINER_REQUEST")
        # The official grader requests SYS_ADMIN. Remove it; qualify compatible
        # tasks with the same official parser/tests and retain incompatibilities.
        kwargs.update(network_disabled=True, network_mode="none", cap_add=[], cap_drop=["ALL"],
                      security_opt=["no-new-privileges"], mem_limit="2g", memswap_limit="2g",
                      nano_cpus=2_000_000_000, pids_limit=256,
                      labels={"sara.repositoryJudgeRun": self.run_id},
                      extra_hosts={"localhost": "127.0.0.1"})
        return CheckedContainer(self.containers.create(**kwargs), self.base_commit)


class RestrictedClient:
    def __init__(self, client, base_commit, run_id):
        self.client = client
        self.containers = RestrictedContainers(client.containers, base_commit, run_id)

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
               "repository": request["repository"], "baseCommit": request["baseCommit"],
               "datasetSha256": pilot.DATASET_SHA256, "resolved": False, "gradeCompleted": False,
               "containerPolicy": "network-none-cap-drop-all-2cpu-2g-256pids", "modelRequests": 0}
    previous = Path.cwd()
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
        client = RestrictedClient(docker.from_env(), row["base_commit"], request["runId"])
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
