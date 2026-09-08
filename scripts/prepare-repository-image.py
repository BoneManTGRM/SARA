#!/usr/bin/env python3
"""Build a PUBLIC base/dependency image. Never give this process judge inputs.

Run on a disposable Docker runner without provider keys or repository credentials.
The input recipe is operator-reviewed and frozen before either comparison arm.
No build context from the SARA checkout, host bind mounts, or Docker secrets.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile


def dockerfile(recipe):
    required = {"repository", "baseCommit", "runtimeImage", "installCommand"}
    if not required <= set(recipe) or set(recipe) - required - {"packageManager", "browser"}:
        raise ValueError("Only public repository, commit, runtime image and install command are allowed")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", recipe["repository"]):
        raise ValueError("Invalid repository")
    if not re.fullmatch(r"[a-f0-9]{40}", recipe["baseCommit"]):
        raise ValueError("Exact base commit required")
    if not re.fullmatch(r"[a-z0-9./_-]+@sha256:[a-f0-9]{64}", recipe["runtimeImage"]):
        raise ValueError("Digest-pinned Node/Git runtime required")
    command = recipe["installCommand"]
    if not isinstance(command, list) or not command or any(not isinstance(x, str) or "\0" in x or "\n" in x for x in command):
        raise ValueError("Install command must be an argument array")
    manager = recipe.get("packageManager")
    if manager is not None and not re.fullmatch(r"(?:npm|pnpm|yarn)@[0-9]+\.[0-9]+\.[0-9]+", manager):
        raise ValueError("Exact package manager version required")
    if recipe.get("browser", False) not in (True, False):
        raise ValueError("Browser flag required")
    setup = []
    if recipe.get("browser"):
        setup.append("RUN apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/*")
    if manager and manager.startswith("yarn@3."):
        setup += ["ENV COREPACK_HOME=/opt/corepack", "RUN npm install --global --force corepack@0.31.0 && corepack enable && corepack prepare " + manager + " --activate && chmod -R a+rX /opt/corepack"]
    elif manager:
        setup.append("RUN npm install --global --force " + manager)
    # Fetch exactly one public commit. No future branches, tags or credentials.
    checkout = ("git init /sara/base && cd /sara/base && "
                f"git fetch --depth=1 https://github.com/{recipe['repository']}.git {recipe['baseCommit']} && "
                "git checkout --detach FETCH_HEAD && git config core.hooksPath /dev/null && "
                "git reflog expire --expire=now --all && git gc --prune=now && "
                "chown -R 1000:1000 /sara/base")
    return "\n".join([
        f"FROM {recipe['runtimeImage']}", "USER root", *setup, "RUN " + checkout,
        "WORKDIR /sara/base", "USER 1000:1000", "ENV HOME=/tmp",
        "RUN " + json.dumps(command),
        "RUN test -z \"$(git status --porcelain --untracked-files=no)\" && test \"$(git rev-list --all --count)\" = 1",
        "USER 1000:1000", "ENTRYPOINT [\"/bin/sleep\"]", "CMD [\"1800\"]", "",
    ])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("recipe", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    raw = args.recipe.read_bytes()
    recipe = json.loads(raw)
    definition = dockerfile(recipe)
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "recipe.json").write_bytes(raw)
    (args.output / "Dockerfile").write_text(definition)
    with tempfile.TemporaryDirectory(prefix="sara-public-base-") as scratch:
        context = pathlib.Path(scratch)
        (context / "Dockerfile").write_text(definition)
        image_id = context / "image-id"
        error = None
        try:
            with (args.output / "build.log").open("w") as log:
                run = subprocess.run(["docker", "build", "--iidfile", str(image_id), str(context)],
                                     stdout=log, stderr=subprocess.STDOUT, timeout=1800)
                exit_code = run.returncode
        except (OSError, subprocess.TimeoutExpired) as failure:
            exit_code = 124 if isinstance(failure, subprocess.TimeoutExpired) else 127
            error = type(failure).__name__
        receipt = {"schemaVersion": 1, "recipeSha256": hashlib.sha256(raw).hexdigest(),
                   "exitCode": exit_code, "error": error,
                   "image": image_id.read_text().strip() if image_id.exists() else None,
                   "qualification": "requires-independent-container-controls",
                   "judgeInputsUsed": False, "modelCalls": 0}
        (args.output / "build-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        if exit_code:
            raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
