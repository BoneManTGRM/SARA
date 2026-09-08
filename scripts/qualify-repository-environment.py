"""Public-only environment preparation. Never loads benchmark solutions."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--index", type=int, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
if not 0 <= args.index < 10:
    raise ValueError("Frozen task index required")
args.output.mkdir(parents=True, exist_ok=False)
tasks = json.loads(Path("docs/benchmarks/swe-bench-multilingual-pilot.json").read_text())["tasks"]
recipes = json.loads(Path("docs/benchmarks/swe-repository-recipes.json").read_text())["tasks"]
task, recipe = tasks[args.index], recipes[args.index]
if recipe["instanceId"] != task["instance_id"]:
    raise ValueError("Recipe selection mismatch")
summary = {"instanceId": task["instance_id"], "modelRequests": 0, "benchmarkAttempts": 0, "prepared": False}
try:
    subprocess.run(["docker", "pull", recipe["runtimeTag"]], check=True, timeout=300)
    runtime = json.loads(subprocess.check_output(["docker", "image", "inspect", recipe["runtimeTag"]], text=True))[0]["RepoDigests"][0]
    resolved = {"repository": task["repo"], "baseCommit": task["base_commit"], "runtimeImage": runtime,
                "packageManager": recipe["packageManager"], "installCommand": recipe["installCommand"], "browser": recipe.get("browser", False)}
    path = args.output / "resolved-recipe.json"
    path.write_text(json.dumps(resolved, indent=2))
    subprocess.run(["python3", "scripts/prepare-repository-image.py", str(path), "--output", str(args.output / "build")], check=True, timeout=1900)
    built = json.loads((args.output / "build/build-receipt.json").read_text())
    environment = {"schemaVersion": 1, "repository": task["repo"], "baseCommit": task["base_commit"],
                   "image": built["image"], "publicTestCommand": recipe["publicTestCommand"], "timeoutSeconds": 900}
    path = args.output / "environment.json"
    path.write_text(json.dumps(environment, indent=2))
    run = subprocess.run(["node", "--import", "tsx", "proof/repository-environment.ts", str(path), str(args.output / "public-tests")], timeout=1000)
    summary.update(prepared=True, publicTestExitCode=run.returncode)
except Exception as error:
    summary["error"] = type(error).__name__ + ": " + str(error)[:1000]
finally:
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2))
print(json.dumps(summary))
raise SystemExit(0 if summary.get("prepared") and summary.get("publicTestExitCode") == 0 else 1)
