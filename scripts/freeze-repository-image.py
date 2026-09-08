"""Retain a qualified public-only image in the existing GitHub container registry."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--input", type=Path, required=True)
args = parser.parse_args()
source = os.environ.get("GITHUB_SHA", "")
if os.environ.get("GITHUB_REPOSITORY") != "BoneManTGRM/SARA" or not re.fullmatch(r"[a-f0-9]{40}", source):
    raise ValueError("Existing repository source required")
environment = json.loads((args.input / "environment.json").read_text())
receipt = json.loads((args.input / "public-tests/public-environment-receipt.json").read_text())
if receipt["environment"] != environment or not receipt["environmentPrepared"] or not receipt["publicTestsPassed"] or receipt["exitCode"] != 0 or receipt["error"] is not None:
    raise ValueError("Fresh qualified environment required")
tasks = json.loads(Path("docs/benchmarks/swe-bench-multilingual-pilot.json").read_text())["tasks"]
matches = [t for t in tasks if t["repo"] == environment["repository"] and t["base_commit"] == environment["baseCommit"]]
if len(matches) != 1:
    raise ValueError("Frozen task binding required")
task = matches[0]
slug = task["instance_id"].lower()
if not re.fullmatch(r"[a-z0-9._-]+", slug) or not re.fullmatch(r"sha256:[a-f0-9]{64}", environment["image"]):
    raise ValueError("Image identity required")
name = "ghcr.io/bonemantgrm/sara-swe-public-" + slug
tag = name + ":" + source

def run(*args):
    return subprocess.check_output(["docker", *args], text=True, timeout=900)

run("tag", environment["image"], tag)
run("push", tag)
digests = json.loads(run("image", "inspect", tag))[0]["RepoDigests"]
pinned = [d for d in digests if d.startswith(name + "@sha256:")]
if len(pinned) != 1:
    raise ValueError("Registry digest missing or ambiguous")
run("pull", pinned[0])
pulled = json.loads(run("image", "inspect", pinned[0]))[0]["Id"]
if pulled != environment["image"]:
    raise ValueError("Published image differs from the qualified local image")
record = {"schemaVersion": 1, "instanceId": task["instance_id"], "sourceRevision": source,
          "qualifiedImageId": environment["image"], "registryImage": pinned[0], "pulledImageId": pulled,
          "publicProofDigest": hashlib.sha256((args.input / "public-tests/public-environment-receipt.json").read_bytes()).hexdigest(),
          "modelCalls": 0, "benchmarkAttempts": 0, "newHostingExpenseUsd": 0}
(args.input / "registry-receipt.json").write_text(json.dumps(record, indent=2))
print(json.dumps(record))
