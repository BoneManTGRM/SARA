"""Single owner-authorized full-kernel pilot. No replay after possible dispatch."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://sara-operator-production.up.railway.app"
ID = "a73c932b-9df1-4ae2-91d3-6378e4e51b82"
OUT = Path("/tmp/sara-kernel-a73c932b")
ARMS = ["regenerate", "ordinary_memory", "optimized"]
HOLD = {"benchmarkId": "41267154-ba42-496a-bb79-1656898ac716", "unresolvedExposureUsd": .15, "confirmedChargeUsd": None}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
OPENER = urllib.request.build_opener(NoRedirect())
def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def sha(value):
    return hashlib.sha256(value).hexdigest()
def save(name, value):
    with (OUT / name).open("w", encoding="utf-8") as file:
        json.dump(value, file, indent=2); file.write("\n"); file.flush(); os.fsync(file.fileno())
def request(method, url, credential, maximum=25_165_824, body=None):
    headers = {"Accept": "application/json", "User-Agent": "SARA-Full-Kernel-One-Use/1"}
    if credential: headers["Authorization"] = "Bearer " + credential
    data = None
    if body is not None:
        data = canonical(body).encode(); headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, method=method, headers=headers, data=data)
    try: response = OPENER.open(req, timeout=30)
    except urllib.error.HTTPError as error: response = error
    with response:
        raw = response.read(maximum + 1)
        if len(raw) > maximum: raise ValueError("RESPONSE_BOUND")
        return response.status, raw

def token():
    url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    if urllib.parse.urlparse(url).scheme != "https": raise ValueError("TOKEN_URL")
    url += ("&" if "?" in url else "?") + urllib.parse.urlencode({"audience": BASE + "/api/coding-benchmark"})
    status, raw = request("GET", url, os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"], 32768)
    if status != 200: raise ValueError("TOKEN_MINT")
    value = json.loads(raw)["value"]
    if not isinstance(value, str) or not value or len(value) > 24000: raise ValueError("TOKEN_SHAPE")
    return value

def authority(runtime):
    return sha(canonical({"schemaVersion": 1, "action": "run_live_reparodynamic_coding_benchmark",
        "evidenceScope": "LAB_SYNTHETIC_ONLY", "benchmarkId": ID, "sourceRevision": runtime,
        "maximumSpendUsd": .15, "maximumModelSpendUsdPerArm": .05, "currentCanaryPercent": 5, "caseCount": 1}).encode())

def validate(value, runtime, run_id, workflow, fresh=False):
    expected = {"sourceRevision": runtime, "benchmarkId": ID, "historicalHold": HOLD,
        "authorityDigest": authority(runtime), "maximumSpendUsd": .15, "maximumModelSpendUsdPerArm": .05,
        "model": "gpt-5.6-luna", "reasoning": "medium", "maximumAttemptsPerArm": 12, "maximumAttemptsPerJob": 3,
        "arms": ARMS, "jobsPerArm": 4, "execution": "full_kernel_exact_repeat_pilot", "experiment": "full_kernel_exact_repeat_pilot",
        "adaptiveOutputAvailable": True, "nativeIntermediateChecks": True, "finalLegacyRequired": True,
        "kernelJobMeasured": True, "persistentReuseMeasured": True, "absoluteMaximumEstablished": False,
        "providerDeadlineMilliseconds": 45000, "productionCustomerJobs": False,
        "authenticatedLaunchPath": "/api/coding-benchmark/run",
        "exclusiveContinuation": None,
        "launcher": {"authentication": "github_oidc_scoped", "benchmarkId": ID, "runId": run_id,
            "workflowRevision": workflow, "runtimeRevision": runtime}}
    for key, wanted in expected.items():
        if type(value.get(key)) is not type(wanted) or value[key] != wanted: raise ValueError("SCOPE_CHANGED_" + key)
    if fresh:
        evidence = value.get("executionEvidence", {})
        if (value.get("ready") is not True or value.get("blockers") != [] or value.get("availableAuthorizationUsd") != .15
            or value.get("unresolvedExposureUsd") != 0 or evidence.get("status") != "not_started"
            or evidence.get("files") != [] or evidence.get("replayAllowed") is not False):
            raise ValueError("FRESH_UNUSED_GRANT_REQUIRED")

def checked_files(evidence):
    rows = evidence.get("files")
    if not isinstance(rows, list) or len(rows) > 128 or evidence.get("replayAllowed") is not False: raise ValueError("EVIDENCE_SHAPE")
    output = {}; total = 0
    for row in rows:
        name = row.get("path"); content = row.get("content")
        if not isinstance(name, str) or not isinstance(content, str): raise ValueError("FILE_SHAPE")
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or str(path) != name or "\\" in name or not name.endswith(".json") or name in output: raise ValueError("UNSAFE_PATH")
        raw = content.encode("utf-8"); total += len(raw)
        if len(raw) != row.get("bytes") or len(raw) > 1048576 or total > 4194304 or sha(raw) != row.get("sha256"): raise ValueError("EVIDENCE_DIGEST")
        output[name] = raw
    return output

def run(runtime, run_id, workflow):
    if len(runtime) != 40 or len(workflow) != 40 or any(c not in "0123456789abcdef" for c in runtime + workflow): raise ValueError("COMMIT_IDENTITY")
    OUT.mkdir(parents=True, exist_ok=True, mode=0o700)
    if (OUT / "post-intent.json").exists(): raise ValueError("LOCAL_DISPATCH_ALREADY_ATTEMPTED")
    started = time.monotonic(); receipts = []
    meta = {"benchmarkId": ID, "runtimeRevision": runtime, "workflowRevision": workflow, "runId": run_id,
        "postAttempts": 0, "maximumSpendUsd": .15, "maximumModelSpendUsdPerArm": .05, "replayAllowed": False}
    def observed(method, path, credential, body=None):
        status, raw = request(method, BASE + path, credential, body=body)
        receipts.append({"method": method, "path": path, "status": status, "bytes": len(raw), "sha256": sha(raw),
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        save("http-receipts.json", receipts); return status, raw
    save("launch-summary.json", meta)
    try:
        status, raw = observed("GET", "/health", None); health = json.loads(raw)
        if status != 200 or health.get("ok") is not True or health.get("constitutionVerified") is not True or health.get("emergencyStopped") is not False: raise ValueError("HEALTH_REJECTED")
        save("health.json", health); credential = token()
        status, raw = observed("GET", "/api/coding-benchmark/readiness", credential)
        (OUT / "preflight.json").write_bytes(raw)
        if status != 200: raise ValueError("READINESS_FAILED")
        validate(json.loads(raw), runtime, run_id, workflow, True)
        body = {"benchmarkId": ID, "sourceRevision": runtime, "authorityDigest": authority(runtime)}
        with (OUT / "post-intent.json").open("x", encoding="utf-8") as file:
            json.dump({"body": body, "maximumPostAttempts": 1}, file); file.flush(); os.fsync(file.fileno())
        directory = os.open(OUT, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
        meta["postAttempts"] = 1; save("launch-summary.json", meta)
        try:
            status, raw = observed("POST", "/api/coding-benchmark/run", credential, body)
            (OUT / "post-response.json").write_bytes(raw)
            meta["postStatus"] = status; meta["postAcknowledged"] = status == 202 and json.loads(raw).get("outcome") == "started"
        except Exception as error:
            meta["postOutcomeUncertain"] = True; meta["postFailureClass"] = type(error).__name__
        save("launch-summary.json", meta)
        deadline = time.monotonic() + 700
        while time.monotonic() < deadline:
            time.sleep(5)
            try:
                status, raw = observed("GET", "/api/coding-benchmark/readiness", token())
                (OUT / "readiness-latest.json").write_bytes(raw)
                if status != 200: continue
                value = json.loads(raw); validate(value, runtime, run_id, workflow)
                evidence = value.get("executionEvidence", {}); files = checked_files(evidence)
                for name, data in files.items():
                    path = OUT / "trial" / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
                if evidence.get("status") != "terminal": continue
                if value.get("ready") is not False or value.get("availableAuthorizationUsd") != 0 or "BENCHMARK_EXECUTION_ALREADY_CLAIMED" not in value.get("blockers", []): raise ValueError("CONSUMED_STATE_REQUIRED")
                claim = json.loads(files["trace/owner-launch-claim.json"])["payload"]
                if claim.get("benchmarkId") != ID or claim.get("sourceRevision") != runtime or claim.get("authorityDigest") != authority(runtime): raise ValueError("CLAIM_MISMATCH")
                required = ["manifest.json", "execution-claim.json", "trace/owner-launch-exit.json", "trace/terminal-accounting.json", "kernel-state/trace/kernel-summary.json"]
                summary = json.loads(files["kernel-state/trace/kernel-summary.json"])["payload"]
                rows = summary.get("rows", [])
                if len(rows) != 12 or {(row.get("arm"), row.get("round")) for row in rows} != {(arm, r) for arm in ARMS for r in range(4)}: raise ValueError("PLANNED_ROWS_MISSING")
                for row in rows:
                    if row.get("result") != "unrun": required.append(f"kernel-state/jobs/{row['arm']}-{row['round']}.json")
                meta.update({"terminal": True, "completeEvidence": all(name in files for name in required),
                    "allJobsVerified": summary.get("allComplete") is True, "evidenceFiles": len(files),
                    "elapsedMilliseconds": (time.monotonic() - started) * 1000})
                save("launch-summary.json", meta); print(json.dumps(meta))
                return 0 if meta["completeEvidence"] and meta["allJobsVerified"] else 2
            except Exception as error:
                meta["lastGetFailureClass"] = type(error).__name__; save("launch-summary.json", meta)
        raise TimeoutError("NO_TERMINAL_EVIDENCE_NO_REPLAY")
    except Exception as error:
        meta.update({"completeEvidence": False, "failureClass": type(error).__name__, "elapsedMilliseconds": (time.monotonic() - started) * 1000})
        save("launch-summary.json", meta); print(json.dumps(meta)); return 2

if __name__ == "__main__":
    if os.environ.get("GITHUB_REPOSITORY") != "BoneManTGRM/SARA" or os.environ.get("GITHUB_RUN_ATTEMPT") != "1" or os.environ.get("GITHUB_REF") != "refs/heads/verify/coding-benchmark-owner-relay-20260905": raise SystemExit("WORKFLOW_IDENTITY_REJECTED")
    raise SystemExit(run(os.environ["EXPECTED_RUNTIME"], os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_SHA"]))
