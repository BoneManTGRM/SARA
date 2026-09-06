#!/usr/bin/env python3
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://sara-operator-production.up.railway.app/api/coding-benchmark"
AUDIENCE = BASE
BENCHMARK_ID = "33d94c9a-0de6-41d9-a843-fe9880994242"
HISTORICAL_ID = "41267154-ba42-496a-bb79-1656898ac716"
EVIDENCE = pathlib.Path("/tmp/sara-relay-live-proof")
EVIDENCE.mkdir(parents=True, exist_ok=True)


def fail(message: str) -> None:
    (EVIDENCE / "failure.txt").write_text(message + "\n", encoding="utf-8")
    raise RuntimeError(message)


def bounded_json_request(url: str, token: str, method: str = "GET", body=None):
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read(65537)
            if len(raw) > 65536:
                fail("Response exceeded evidence size limit.")
            return response.status, json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as error:
        raw = error.read(65537)
        parsed = None
        if len(raw) <= 65536:
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except Exception:
                parsed = None
        return error.code, parsed


def oidc_token() -> str:
    request_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    request_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    if not request_url or not request_token:
        fail("GitHub OIDC request capability is unavailable.")
    separator = "&" if "?" in request_url else "?"
    url = request_url + separator + urllib.parse.urlencode({"audience": AUDIENCE})
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + request_token, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read(32769)
        if len(raw) > 32768:
            fail("OIDC response exceeded size limit.")
        payload = json.loads(raw.decode("utf-8"))
    token = payload.get("value")
    if not isinstance(token, str) or token.count(".") != 2 or len(token) > 24000:
        fail("GitHub OIDC token was malformed.")
    return token


expected_runtime = os.environ.get("EXPECTED_RUNTIME", "").strip().lower()
workflow_revision = os.environ.get("GITHUB_SHA", "").strip().lower()
if len(expected_runtime) != 40 or any(ch not in "0123456789abcdef" for ch in expected_runtime):
    fail("EXPECTED_RUNTIME is malformed.")
if len(workflow_revision) != 40 or any(ch not in "0123456789abcdef" for ch in workflow_revision):
    fail("GITHUB_SHA is malformed.")

token = oidc_token()
readiness = None
last_status = None
# Readiness polling is non-spending. The POST below is deliberately never retried.
for _ in range(24):
    status, candidate = bounded_json_request(BASE + "/readiness", token)
    last_status = status
    if status == 200 and isinstance(candidate, dict):
        readiness = candidate
        break
    time.sleep(5)

if readiness is None:
    fail(f"Authenticated readiness never became available; final HTTP status {last_status}.")

(EVIDENCE / "readiness.json").write_text(json.dumps(readiness, indent=2, sort_keys=True) + "\n", encoding="utf-8")

checks = [
    (readiness.get("benchmarkId") == BENCHMARK_ID, "Wrong active benchmark grant."),
    (readiness.get("ready") is True, "Benchmark readiness is not green."),
    (readiness.get("sourceRevision") == expected_runtime, "Runtime source revision mismatch."),
    (readiness.get("maximumSpendUsd") == 0.15, "Total spend ceiling changed."),
    (readiness.get("maximumModelSpendUsdPerArm") == 0.075, "Per-arm spend ceiling changed."),
    (readiness.get("unresolvedExposureUsd") == 0, "New grant already has unresolved exposure."),
    (readiness.get("model") == "gpt-5.6-luna", "Model route changed."),
    (readiness.get("reasoning") == "medium", "Reasoning level changed."),
    (readiness.get("maximumAttemptsPerArm") == 3, "Attempt ceiling changed."),
    (readiness.get("order") == ["luna_reparodynamic", "luna"], "Preregistered arm order changed."),
]
historical = readiness.get("historicalHold")
checks.extend([
    (isinstance(historical, dict), "Historical hold evidence missing."),
    (isinstance(historical, dict) and historical.get("benchmarkId") == HISTORICAL_ID, "Historical benchmark identity changed."),
    (isinstance(historical, dict) and historical.get("unresolvedExposureUsd") == 0.15, "Historical unresolved hold changed."),
])
launcher = readiness.get("launcher")
checks.extend([
    (isinstance(launcher, dict), "Scoped launcher evidence missing."),
    (isinstance(launcher, dict) and launcher.get("authentication") == "github_oidc_scoped", "Launcher authentication changed."),
    (isinstance(launcher, dict) and launcher.get("benchmarkId") == BENCHMARK_ID, "Launcher benchmark scope mismatch."),
    (isinstance(launcher, dict) and launcher.get("workflowRevision") == workflow_revision, "Launcher workflow revision mismatch."),
    (isinstance(launcher, dict) and launcher.get("runtimeRevision") == expected_runtime, "Launcher runtime revision mismatch."),
])
for ok, message in checks:
    if not ok:
        fail(message)
authority = readiness.get("authorityDigest")
if not isinstance(authority, str) or len(authority) != 64 or any(ch not in "0123456789abcdef" for ch in authority):
    fail("Authority digest is malformed.")

launch_body = {
    "benchmarkId": BENCHMARK_ID,
    "sourceRevision": expected_runtime,
    "authorityDigest": authority,
}
status, launch = bounded_json_request(BASE + "/run", token, method="POST", body=launch_body)
(EVIDENCE / "launch-response.json").write_text(json.dumps({"httpStatus": status, "body": launch}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
if status != 202 or not isinstance(launch, dict):
    fail(f"Single launch request was rejected with HTTP {status}; no retry was attempted.")
if launch.get("benchmarkId") != BENCHMARK_ID or launch.get("outcome") != "started" or launch.get("replayAllowed") is not False:
    fail("Launch response violated the one-use contract.")
print(json.dumps({"benchmarkId": BENCHMARK_ID, "outcome": "started", "replayAllowed": False}, separators=(",", ":")))
