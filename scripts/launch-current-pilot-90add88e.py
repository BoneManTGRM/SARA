"""One owner-approved POST at most; subsequent evidence collection is GET-only."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://sara-operator-production.up.railway.app"
AUDIENCE = BASE + "/api/coding-benchmark"
ID = "90add88e-27a3-4f9b-9437-7e41e5878433"
HOLD = {"benchmarkId": "41267154-ba42-496a-bb79-1656898ac716", "unresolvedExposureUsd": .15, "confirmedChargeUsd": None}
OUT = Path("/tmp/sara-current-pilot-90add88e")
MAX_RESPONSE = 25_165_824

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = urllib.request.build_opener(NoRedirect())

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def digest(value):
    return hashlib.sha256(value).hexdigest()

def save(name, value):
    path = OUT / name
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())

def request(method, url, credential, maximum, body=None):
    headers = {"Accept": "application/json", "User-Agent": "SARA-Authorized-Current-Pilot/1"}
    if credential:
        headers["Authorization"] = "Bearer " + credential
    data = None
    if body is not None:
        data = canonical(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, method=method, headers=headers, data=data)
    try:
        response = OPENER.open(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(maximum + 1)
        if len(raw) > maximum:
            raise ValueError("RESPONSE_BOUND")
        return response.status, raw

def token():
    url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    if urllib.parse.urlparse(url).scheme != "https":
        raise ValueError("TOKEN_URL")
    url += ("&" if "?" in url else "?") + urllib.parse.urlencode({"audience": AUDIENCE})
    status, raw = request("GET", url, os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"], 32768)
    if status != 200:
        raise ValueError("TOKEN_MINT")
    value = json.loads(raw)["value"]
    if not isinstance(value, str) or len(value) > 24000:
        raise ValueError("TOKEN_SHAPE")
    return value

def authority(runtime):
    return digest(canonical({"schemaVersion": 1, "action": "run_live_reparodynamic_coding_benchmark",
        "evidenceScope": "LAB_SYNTHETIC_ONLY", "benchmarkId": ID, "sourceRevision": runtime,
        "maximumSpendUsd": .15, "maximumModelSpendUsdPerArm": .075,
        "currentCanaryPercent": 5, "caseCount": 1}).encode())

def validate_identity(value, runtime, run_id, workflow):
    if value.get("sourceRevision") != runtime or value.get("benchmarkId") != ID:
        raise ValueError("SCOPE_OR_RUNTIME")
    if value.get("historicalHold") != HOLD:
        raise ValueError("HISTORICAL_HOLD_CHANGED")
    expected = {"authentication": "github_oidc_scoped", "benchmarkId": ID, "runId": run_id,
        "workflowRevision": workflow, "runtimeRevision": runtime}
    if value.get("launcher") != expected:
        raise ValueError("LAUNCHER_IDENTITY")
    if value.get("authorityDigest") != authority(runtime):
        raise ValueError("AUTHORITY_DIGEST")
    expected_settings = {"maximumSpendUsd": .15, "maximumModelSpendUsdPerArm": .075,
        "model": "gpt-5.6-luna", "reasoning": "medium", "maximumAttemptsPerArm": 3,
        "order": ["luna_reparodynamic", "luna"], "compactOutput": False, "compilerCaching": False,
        "execution": "current_components_cold_pilot",
        "experiment": "current_components_cold_pilot", "adaptiveOutputAvailable": True,
        "nativeIntermediateChecks": True, "finalLegacyRequired": True, "kernelJobMeasured": False, "persistentReuseMeasured": False, "authenticatedLaunchPath": "/api/coding-benchmark/run"}
    for key, expected_value in expected_settings.items():
        if type(value.get(key)) is not type(expected_value) or value[key] != expected_value:
            raise ValueError("SETTINGS_CHANGED_" + key)

def validate_preflight(value, runtime, run_id, workflow):
    validate_identity(value, runtime, run_id, workflow)
    evidence = value.get("executionEvidence", {})
    if (value.get("ready") is not True or value.get("blockers") != []
        or value.get("availableAuthorizationUsd") != .15 or value.get("unresolvedExposureUsd") != 0
        or evidence.get("status") != "not_started" or evidence.get("files") != []
        or evidence.get("replayAllowed") is not False):
        raise ValueError("NEW_UNUSED_AUTHORIZATION_REQUIRED")

def evidence_files(evidence):
    files = evidence.get("files")
    if not isinstance(files, list) or len(files) > 128 or evidence.get("replayAllowed") is not False:
        raise ValueError("EVIDENCE_SHAPE")
    output = {}; total = 0
    for item in files:
        name = item.get("path"); content = item.get("content")
        if not isinstance(name, str) or not isinstance(content, str):
            raise ValueError("FILE_SHAPE")
        p = PurePosixPath(name)
        if p.is_absolute() or ".." in p.parts or str(p) != name or "\\" in name or not name.endswith(".json") or name in output:
            raise ValueError("UNSAFE_PATH")
        data = content.encode("utf-8"); total += len(data)
        if len(data) != item.get("bytes") or len(data) > 1_048_576 or total > 4_194_304 or digest(data) != item.get("sha256"):
            raise ValueError("EVIDENCE_DIGEST")
        output[name] = data
    return output

def run_comparison(runtime, run_id, workflow):
    started = time.monotonic()
    OUT.mkdir(parents=True, exist_ok=True)
    # An existing local intent prevents another dispatch even in this same process environment.
    if (OUT / "post-intent.json").exists():
        raise ValueError("LOCAL_LAUNCH_ALREADY_ATTEMPTED")
    metadata = {"benchmarkId": ID, "runtimeRevision": runtime, "workflowRevision": workflow,
        "runId": run_id, "maximumSpendUsd": .15, "postAttempts": 0,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "replayAllowed": False}
    receipts = []
    def observed(method, path, credential, body=None):
        status, raw = request(method, BASE + path, credential, MAX_RESPONSE, body)
        receipts.append({"method": method, "path": path, "status": status, "bytes": len(raw), "sha256": digest(raw),
            "observedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        save("http-receipts.json", receipts)
        return status, raw
    save("launch-summary.json", metadata)
    try:
        status, raw = observed("GET", "/health", None)
        health = json.loads(raw)
        if status != 200 or health.get("ok") is not True or health.get("constitutionVerified") is not True or health.get("emergencyStopped") is not False:
            raise ValueError("HEALTH_FAILED")
        save("health.json", health)
        credential = token()
        status, raw = observed("GET", "/api/coding-benchmark/readiness", credential)
        (OUT / "preflight.json").write_bytes(raw)
        if status != 200:
            raise ValueError("READINESS_GET_FAILED")
        ready = json.loads(raw)
        validate_preflight(ready, runtime, run_id, workflow)
        body = {"benchmarkId": ID, "sourceRevision": runtime, "authorityDigest": authority(runtime)}
        # Record and flush intent BEFORE network dispatch. Never retry this POST.
        save("post-intent.json", {"body": body, "runId": run_id, "workflowRevision": workflow, "maximumPostAttempts": 1})
        metadata["postAttempts"] = 1
        save("launch-summary.json", metadata)
        try:
            status, raw = observed("POST", "/api/coding-benchmark/run", credential, body)
            (OUT / "post-response.json").write_bytes(raw)
            metadata["postStatus"] = status
            metadata["postAcknowledged"] = status == 202 and json.loads(raw).get("outcome") == "started"
        except Exception as error:
            metadata["postOutcomeUncertain"] = True
            metadata["postFailureClass"] = type(error).__name__
        save("launch-summary.json", metadata)
        deadline = time.monotonic() + 330
        while time.monotonic() < deadline:
            time.sleep(5)
            try:
                status, raw = observed("GET", "/api/coding-benchmark/readiness", token())
                (OUT / "readiness-latest.json").write_bytes(raw)
                if status != 200:
                    continue
                value = json.loads(raw)
                validate_identity(value, runtime, run_id, workflow)
                evidence = value.get("executionEvidence", {})
                files = evidence_files(evidence)
                for name, data in files.items():
                    path = OUT / "trial" / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                if evidence.get("status") != "terminal":
                    continue
                if value.get("ready") is not False or value.get("availableAuthorizationUsd") != 0 or "BENCHMARK_EXECUTION_ALREADY_CLAIMED" not in value.get("blockers", []):
                    raise ValueError("CONSUMED_STATE_REQUIRED")
                claim = json.loads(files["trace/owner-launch-claim.json"])["payload"]
                if claim.get("benchmarkId") != ID or claim.get("sourceRevision") != runtime or claim.get("authorityDigest") != authority(runtime):
                    raise ValueError("EXECUTION_IDENTITY_CHANGED")
                required = ["manifest.json", "execution-claim.json", "pairs/0001-pair.json", "pairs/0001-luna.json",
                    "pairs/0001-luna_reparodynamic.json", "trace/terminal-accounting.json", "trace/owner-launch-exit.json"]
                metadata.update({"terminal": True, "evidenceFiles": len(files), "completeEvidence": all(p in files for p in required),
                    "elapsedMilliseconds": (time.monotonic() - started) * 1000})
                save("launch-summary.json", metadata)
                print(json.dumps(metadata))
                return 0 if metadata["completeEvidence"] else 2
            except Exception as error:
                metadata["lastGetFailureClass"] = type(error).__name__
                save("launch-summary.json", metadata)
        raise TimeoutError("TERMINAL_EVIDENCE_NOT_OBSERVED_NO_REPLAY")
    except Exception as error:
        metadata.update({"completeEvidence": False, "failureClass": type(error).__name__, "elapsedMilliseconds": (time.monotonic()-started)*1000})
        save("launch-summary.json", metadata)
        print(json.dumps(metadata))
        return 2

def main():
    if os.environ.get("GITHUB_RUN_ATTEMPT") != "1" or os.environ.get("GITHUB_REPOSITORY") != "BoneManTGRM/SARA" or os.environ.get("GITHUB_REF") != "refs/heads/verify/coding-benchmark-owner-relay-20260905":
        raise SystemExit("WORKFLOW_IDENTITY_REJECTED")
    raise SystemExit(run_comparison(os.environ["EXPECTED_RUNTIME"], os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_SHA"]))

if __name__ == "__main__":
    main()
