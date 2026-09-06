"""One capped live reuse-pilot POST; all subsequent recovery is GET-only."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://sara-operator-production.up.railway.app"
ID = "eb659a8f-a4b1-4ba5-81d9-f7ade1f0879d"
OUT = Path("/tmp/sara-maximum-reuse-eb659a8f")
HOLD = {"benchmarkId":"41267154-ba42-496a-bb79-1656898ac716","unresolvedExposureUsd":.15,"confirmedChargeUsd":None}
ARMS = ["regenerate", "ordinary_memory", "optimized"]
MAX_BYTES = 25_165_824
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
OPENER = urllib.request.build_opener(NoRedirect())
def canonical(v):
    return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False)
def digest(v):
    return hashlib.sha256(v).hexdigest()
def save(name,value):
    with (OUT/name).open("w",encoding="utf-8") as f:
        json.dump(value,f,indent=2); f.write("\n"); f.flush(); os.fsync(f.fileno())
def request(method,url,credential,maximum=MAX_BYTES,body=None):
    headers={"Accept":"application/json","User-Agent":"SARA-Maximum-Observed-Reuse-Pilot/1"}
    if credential: headers["Authorization"]="Bearer "+credential
    data=None
    if body is not None:
        data=canonical(body).encode(); headers["Content-Type"]="application/json"
    req=urllib.request.Request(url,method=method,headers=headers,data=data)
    try: response=OPENER.open(req,timeout=30)
    except urllib.error.HTTPError as e: response=e
    with response:
        raw=response.read(maximum+1)
        if len(raw)>maximum: raise ValueError("RESPONSE_BOUND")
        return response.status,raw

def token():
    url=os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    if urllib.parse.urlparse(url).scheme!="https": raise ValueError("TOKEN_URL")
    url+=("&" if "?" in url else "?")+urllib.parse.urlencode({"audience":BASE+"/api/coding-benchmark"})
    status,raw=request("GET",url,os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"],32768)
    if status!=200: raise ValueError("TOKEN_MINT")
    value=json.loads(raw)["value"]
    if not isinstance(value,str) or not value or len(value)>24000: raise ValueError("TOKEN_SHAPE")
    return value

def authority(runtime):
    return digest(canonical({"schemaVersion":1,"action":"run_live_reparodynamic_coding_benchmark",
        "evidenceScope":"LAB_SYNTHETIC_ONLY","benchmarkId":ID,"sourceRevision":runtime,
        "maximumSpendUsd":.15,"maximumModelSpendUsdPerArm":.05,"currentCanaryPercent":5,"caseCount":1}).encode())

def validate(value,runtime,run_id,workflow,fresh=False):
    expected={"sourceRevision":runtime,"benchmarkId":ID,"historicalHold":HOLD,
        "authorityDigest":authority(runtime),"maximumSpendUsd":.15,"maximumModelSpendUsdPerArm":.05,
        "model":"gpt-5.6-luna","reasoning":"medium","maximumAttemptsPerArm":12,"maximumAttemptsPerJob":3,
        "arms":ARMS,"jobsPerArm":4,"execution":"maximum_observed_reuse_pilot","experiment":"maximum_observed_reuse_pilot",
        "adaptiveOutputAvailable":True,"nativeIntermediateChecks":True,"finalLegacyRequired":True,
        "kernelJobMeasured":False,"persistentReuseMeasured":True,"absoluteMaximumEstablished":False,
        "authenticatedLaunchPath":"/api/coding-benchmark/run",
        "launcher":{"authentication":"github_oidc_scoped","benchmarkId":ID,"runId":run_id,
            "workflowRevision":workflow,"runtimeRevision":runtime}}
    for k,v in expected.items():
        if type(value.get(k)) is not type(v) or value[k]!=v: raise ValueError("SCOPE_CHANGED_"+k)
    if fresh:
        e=value.get("executionEvidence",{})
        if (value.get("ready") is not True or value.get("blockers")!=[] or value.get("availableAuthorizationUsd")!=.15
            or value.get("unresolvedExposureUsd")!=0 or e.get("status")!="not_started" or e.get("files")!=[]
            or e.get("replayAllowed") is not False): raise ValueError("FRESH_UNUSED_GRANT_REQUIRED")

def checked_files(e):
    rows=e.get("files")
    if not isinstance(rows,list) or len(rows)>128 or e.get("replayAllowed") is not False: raise ValueError("EVIDENCE_SHAPE")
    output={}; total=0
    for r in rows:
        name=r.get("path");content=r.get("content")
        if not isinstance(name,str) or not isinstance(content,str): raise ValueError("FILE_SHAPE")
        p=PurePosixPath(name)
        if p.is_absolute() or ".." in p.parts or str(p)!=name or "\\" in name or not name.endswith(".json") or name in output: raise ValueError("UNSAFE_PATH")
        b=content.encode("utf-8");total+=len(b)
        if len(b)!=r.get("bytes") or len(b)>1048576 or total>4194304 or digest(b)!=r.get("sha256"): raise ValueError("EVIDENCE_DIGEST")
        output[name]=b
    return output

def run(runtime,run_id,workflow):
    if len(runtime)!=40 or len(workflow)!=40 or any(c not in "0123456789abcdef" for c in runtime+workflow): raise ValueError("COMMIT_IDENTITY")
    OUT.mkdir(parents=True,exist_ok=True)
    if (OUT/"post-intent.json").exists(): raise ValueError("LOCAL_DISPATCH_ALREADY_ATTEMPTED")
    start=time.monotonic(); receipts=[]
    meta={"benchmarkId":ID,"runtimeRevision":runtime,"workflowRevision":workflow,"runId":run_id,"postAttempts":0,
        "maximumSpendUsd":.15,"maximumModelSpendUsdPerArm":.05,"replayAllowed":False}
    def observed(method,path,credential,body=None):
        status,raw=request(method,BASE+path,credential,body=body)
        receipts.append({"method":method,"path":path,"status":status,"bytes":len(raw),"sha256":digest(raw),
            "at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())})
        save("http-receipts.json",receipts); return status,raw
    save("launch-summary.json",meta)
    try:
        status,raw=observed("GET","/health",None);h=json.loads(raw)
        if status!=200 or h.get("ok") is not True or h.get("constitutionVerified") is not True or h.get("emergencyStopped") is not False: raise ValueError("HEALTH_REJECTED")
        save("health.json",h);credential=token()
        status,raw=observed("GET","/api/coding-benchmark/readiness",credential)
        (OUT/"preflight.json").write_bytes(raw)
        if status!=200: raise ValueError("READINESS_FAILED")
        validate(json.loads(raw),runtime,run_id,workflow,True)
        body={"benchmarkId":ID,"sourceRevision":runtime,"authorityDigest":authority(runtime)}
        # Exclusive durable intent precedes the only POST; never issue a second POST.
        with (OUT/"post-intent.json").open("x",encoding="utf-8") as f:
            json.dump({"body":body,"maximumPostAttempts":1},f);f.flush();os.fsync(f.fileno())
        meta["postAttempts"]=1;save("launch-summary.json",meta)
        try:
            status,raw=observed("POST","/api/coding-benchmark/run",credential,body)
            (OUT/"post-response.json").write_bytes(raw)
            meta["postStatus"]=status;meta["postAcknowledged"]=status==202 and json.loads(raw).get("outcome")=="started"
        except Exception as e: meta["postOutcomeUncertain"]=True;meta["postFailureClass"]=type(e).__name__
        save("launch-summary.json",meta)
        deadline=time.monotonic()+340
        while time.monotonic()<deadline:
            time.sleep(5)
            try:
                status,raw=observed("GET","/api/coding-benchmark/readiness",token())
                (OUT/"readiness-latest.json").write_bytes(raw)
                if status!=200: continue
                v=json.loads(raw);validate(v,runtime,run_id,workflow)
                evidence=v.get("executionEvidence",{});files=checked_files(evidence)
                for name,data in files.items():
                    p=OUT/"trial"/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
                if evidence.get("status")!="terminal": continue
                if v.get("ready") is not False or v.get("availableAuthorizationUsd")!=0 or "BENCHMARK_EXECUTION_ALREADY_CLAIMED" not in v.get("blockers",[]): raise ValueError("CONSUMED_STATE_REQUIRED")
                claim=json.loads(files["trace/owner-launch-claim.json"])["payload"]
                if claim.get("benchmarkId")!=ID or claim.get("sourceRevision")!=runtime or claim.get("authorityDigest")!=authority(runtime): raise ValueError("CLAIM_MISMATCH")
                needed=["manifest.json","execution-claim.json","trace/owner-launch-exit.json","trace/terminal-accounting.json",
                    "reuse-state/trace/reuse-summary.json"]+[f"reuse-state/jobs/{a}-{n}.json" for a in ARMS for n in range(4)]
                meta.update({"terminal":True,"completeEvidence":all(n in files for n in needed),"evidenceFiles":len(files),"elapsedMilliseconds":(time.monotonic()-start)*1000})
                if "reuse-state/trace/reuse-summary.json" in files:
                    meta["allJobsVerified"]=json.loads(files["reuse-state/trace/reuse-summary.json"])["payload"].get("allComplete") is True
                save("launch-summary.json",meta);print(json.dumps(meta));return 0 if meta["completeEvidence"] else 2
            except Exception as e: meta["lastGetFailureClass"]=type(e).__name__;save("launch-summary.json",meta)
        raise TimeoutError("NO_TERMINAL_EVIDENCE_NO_REPLAY")
    except Exception as e:
        meta.update({"completeEvidence":False,"failureClass":type(e).__name__,"elapsedMilliseconds":(time.monotonic()-start)*1000})
        save("launch-summary.json",meta);print(json.dumps(meta));return 2

if __name__=="__main__":
    if os.environ.get("GITHUB_REPOSITORY")!="BoneManTGRM/SARA" or os.environ.get("GITHUB_RUN_ATTEMPT")!="1" or os.environ.get("GITHUB_REF")!="refs/heads/verify/coding-benchmark-owner-relay-20260905": raise SystemExit("WORKFLOW_IDENTITY_REJECTED")
    raise SystemExit(run(os.environ["EXPECTED_RUNTIME"],os.environ["GITHUB_RUN_ID"],os.environ["GITHUB_SHA"]))
