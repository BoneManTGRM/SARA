"""Reproducible task preparation and judge-only controls; never invokes a model."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request

DATASET_REVISION = "846e647b9f33c0b51b739d005d13d85493c9af09"
DATASET_SHA256 = "92abca7cb527b41a9f66d03a26ce441ff7319e3a49f985998fd56be4bb9b08b2"
HARNESS_REVISION = "02e7a74ffd0b707aab73d203fe87bdc7c76afc8e"
SEED = "SARA-SWE-MULTILINGUAL-20260907-v1"
REPOSITORIES = {
    "axios/axios", "babel/babel", "facebook/docusaurus",
    "immutable-js/immutable-js", "mrdoob/three.js", "preactjs/preact", "vuejs/core",
}
AGENT_FIELDS = ("instance_id", "repo", "base_commit", "problem_statement")
MANIFEST_FIELDS = ("instance_id", "repo", "base_commit", "image", "log_parser")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def select(rows):
    """Selection deliberately uses only repo and ID; never patch size or outcome."""
    if len({r["instance_id"] for r in rows}) != len(rows):
        raise ValueError("duplicate instance ID")
    key = lambda value: digest((SEED + "\n" + value).encode())
    groups = {repo: sorted((r for r in rows if r["repo"] == repo),
                          key=lambda r: key(r["instance_id"])) for repo in REPOSITORIES}
    if any(not group for group in groups.values()):
        raise ValueError("missing preregistered repository")
    result = []
    while len(result) < 10:
        before = len(result)
        for repo in sorted(groups, key=key):
            if groups[repo] and len(result) < 10:
                result.append(groups[repo].pop(0))
        if len(result) == before:
            raise ValueError("insufficient instances")
    return result


def manifest(rows):
    return {"schemaVersion": 1, "dataset": "SWE-bench/SWE-bench_Multilingual",
            "datasetRevision": DATASET_REVISION, "datasetSha256": DATASET_SHA256,
            "harnessRevision": HARNESS_REVISION, "seed": SEED,
            "selection": "SHA256(seed + newline + value), repo round-robin, ten tasks",
            "tasks": [{k: row[k] for k in MANIFEST_FIELDS} for row in select(rows)]}


def agent_input(row):
    return {k: row[k] for k in AGENT_FIELDS}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Never overwrite evidence or silently recycle a run.
    with path.open("x") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")


def load_rows(path):
    import pyarrow.parquet as parquet
    if not path.exists():
        url = ("https://huggingface.co/datasets/SWE-bench/SWE-bench_Multilingual/resolve/"
               + DATASET_REVISION + "/data/test-00000-of-00001.parquet")
        with urllib.request.urlopen(url, timeout=60) as response:
            content = response.read(10 * 1024 * 1024 + 1)
        if digest(content) != DATASET_SHA256:
            raise ValueError("dataset digest mismatch")
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as handle:
            handle.write(content)
    if digest(path.read_bytes()) != DATASET_SHA256:
        raise ValueError("dataset digest mismatch")
    return parquet.read_table(path).to_pylist()


def control_status(base, gold, observed_expected_failure=False):
    # Unresolved alone is insufficient: require actual expected-test failure and
    # all formerly passing tests maintained in the negative control.
    if not isinstance(base, dict) or not isinstance(gold, dict):
        return False
    tests = base.get("tests_status", {})
    failed = tests.get("FAIL_TO_PASS", {}).get("failure", [])
    regressed = tests.get("PASS_TO_PASS", {}).get("failure", [])
    return (observed_expected_failure and base.get("resolved") is False and bool(failed) and not regressed
            and base.get("tests_status") is not None and gold.get("resolved") is True)


def controls(row, output, harness, launch_id):
    """This function runs only in a judge job with no generation credentials."""
    import docker
    from swebench.harness.run_evaluation import run_instance
    from swebench.harness.grading import get_logs_eval
    from swebench.harness.utils import make_test_spec
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=harness, text=True).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=harness, text=True).strip()
    if actual != HARNESS_REVISION or dirty:
        raise ValueError("harness source mismatch")
    output.mkdir(parents=True, exist_ok=False)
    result = {"schemaVersion": 1, "instanceId": row["instance_id"],
              "kind": "official_harness_controls_only", "saraScore": None,
              "modelRequests": 0, "harnessRevision": actual,
              "datasetSha256": DATASET_SHA256, "controlsQualified": False}
    previous = Path.cwd()
    try:
        os.chdir(output)
        client = docker.from_env()
        client.ping()
        image = client.images.pull(row["image"])
        result["imageId"] = image.id
        result["imageRepoDigests"] = image.attrs.get("RepoDigests", [])
        if not result["imageRepoDigests"]:
            raise ValueError("image has no registry digest")
        spec = make_test_spec(row)
        spec.image = image.id  # Both controls use the same immutable local image.
        head = client.containers.run(image.id, ["git", "rev-parse", "HEAD"],
                                     working_dir="/testbed", network_disabled=True, remove=True)
        result["imageBaseCommit"] = head.decode().strip()
        if result["imageBaseCommit"] != row["base_commit"]:
            raise ValueError("image checkout does not match frozen base commit")
        details = {}
        for label in ("base", "gold"):
            run_id = launch_id + "-" + label
            prediction = {"instance_id": row["instance_id"],
                          "model_name_or_path": "harness-control-" + label,
                          "model_patch": "" if label == "base" else row["patch"]}
            value = run_instance(spec, prediction, client, run_id,
                                 timeout=900, skip_patch=(label == "base"))
            details[label] = value[1][row["instance_id"]] if value else None
        base_log = Path("logs/evaluation") / (launch_id + "-base") / "harness-control-base" / row["instance_id"] / "test_output.txt"
        statuses, found = get_logs_eval(spec, base_log) if base_log.exists() else ({}, False)
        observed_failure = found and any(statuses.get(test) in ("FAILED", "ERROR") for test in spec.FAIL_TO_PASS)
        result["baseExpectedFailureObserved"] = observed_failure
        result["controlsQualified"] = control_status(details["base"], details["gold"], observed_failure)
        result["baseResolved"] = details["base"].get("resolved") if details["base"] else None
        result["goldResolved"] = details["gold"].get("resolved") if details["gold"] else None
    except Exception as error:
        result["error"] = type(error).__name__ + ": " + str(error)[:1000]
    finally:
        os.chdir(previous)
        write_json(output / "control-summary.json", result)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["controlsQualified"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "controls"])
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--harness", type=Path)
    parser.add_argument("--index", type=int)
    args = parser.parse_args()
    rows = load_rows(args.dataset)
    frozen = manifest(rows)
    if args.command == "prepare":
        write_json(args.manifest, frozen)
        write_json(args.output / "agent-inputs.json", [agent_input(r) for r in select(rows)])
        return 0
    if frozen != json.loads(args.manifest.read_text()):
        raise ValueError("preregistered selection mismatch")
    if args.index is None or not 0 <= args.index < 10 or args.harness is None:
        raise ValueError("control index and pinned harness required")
    launch_id = "sara-controls-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
    return controls(select(rows)[args.index], args.output.resolve(), args.harness.resolve(), launch_id)


if __name__ == "__main__":
    raise SystemExit(main())
