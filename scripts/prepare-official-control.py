"""Judge-only fixture setup. Published repairs are controls, never agent input."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location("pilot", Path(__file__).with_name("swe-bench-pilot.py"))
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--index", type=int, required=True)
parser.add_argument("--harness", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
if not 0 <= args.index < 10:
    raise ValueError("Frozen control index required")
args.output.mkdir(parents=True, exist_ok=False)
dataset = args.output / "judge.parquet"
rows = pilot.load_rows(dataset)
if pilot.manifest(rows) != json.loads(Path("docs/benchmarks/swe-bench-multilingual-pilot.json").read_text()):
    raise ValueError("Frozen selection drift")
row = pilot.select(rows)[args.index]
subprocess.run(["docker", "pull", "node:22-bookworm"], check=True, timeout=300)
runtime = json.loads(subprocess.check_output(["docker", "image", "inspect", "node:22-bookworm"], text=True))[0]["RepoDigests"][0]
# Source-only public image for this grading control. Actual dependency recipes
# have their own qualification workflow; this is not evidence of their success.
recipe = {"repository": row["repo"], "baseCommit": row["base_commit"], "runtimeImage": runtime, "installCommand": ["true"]}
recipe_path = args.output / "recipe.json"
recipe_path.write_text(json.dumps(recipe))
subprocess.run(["python3", "scripts/prepare-repository-image.py", str(recipe_path), "--output", str(args.output / "build")], check=True, timeout=1900)
image = json.loads((args.output / "build/build-receipt.json").read_text())["image"]
subprocess.run(["docker", "pull", row["image"]], check=True, timeout=900)
official = json.loads(subprocess.check_output(["docker", "image", "inspect", row["image"]], text=True))[0]["RepoDigests"][0]
fixture_proxy_image = None
if row["instance_id"] == "axios__axios-5085":
    subprocess.run(["docker", "pull", "python:3.11-slim-bookworm"], check=True, timeout=300)
    fixture_proxy_image = json.loads(subprocess.check_output(["docker", "image", "inspect", "python:3.11-slim-bookworm"], text=True))[0]["RepoDigests"][0]
control = {"task": pilot.agent_input(row), "referencePatch": row["patch"], "judgeImage": official,
           "fixtureProxyImage": fixture_proxy_image,
           "datasetPath": str(dataset.resolve()), "harnessPath": str(args.harness.resolve()),
           "environment": {"schemaVersion": 1, "repository": row["repo"], "baseCommit": row["base_commit"],
                           "image": image, "publicTestCommand": ["git", "diff", "--check"], "timeoutSeconds": 900}}
(args.output / "control-input.json").write_text(json.dumps(control))
