"""Reuse the hash-pinned one-POST transport with a NEW grant and output directory."""
import hashlib
import os
from pathlib import Path

GRANT = "d89f2a9c-3e8e-4e91-a41d-3f0836c1b3ea"
SOURCE_SHA256 = "e84185e39c5ae32a23814c827e0bde334299facf188c218da9446436c2ed389f"

def load_transport():
    path = Path(__file__).with_name("launch-max-reuse-eb659a8f.py")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError("LAUNCH_TRANSPORT_SOURCE_DRIFT")
    namespace = {"__name__": "sara_verified_transport_library", "__file__": str(path)}
    exec(compile(raw, str(path), "exec"), namespace)
    if namespace["ID"] != "eb659a8f-a4b1-4ba5-81d9-f7ade1f0879d":
        raise ValueError("UNEXPECTED_TRANSPORT_DEFAULT")
    namespace["ID"] = GRANT
    namespace["OUT"] = Path("/tmp/sara-hardened-reuse-d89f2a9c")
    return namespace

def main():
    if (os.environ.get("GITHUB_REPOSITORY") != "BoneManTGRM/SARA" or
        os.environ.get("GITHUB_RUN_ATTEMPT") != "1" or
        os.environ.get("GITHUB_REF") != "refs/heads/verify/coding-benchmark-owner-relay-20260905" or
        os.environ.get("GITHUB_ACTOR") != "BoneManTGRM"):
        raise SystemExit("WORKFLOW_IDENTITY_REJECTED")
    transport = load_transport()
    raise SystemExit(transport["run"](os.environ["EXPECTED_RUNTIME"], os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_SHA"]))

if __name__ == "__main__":
    main()
