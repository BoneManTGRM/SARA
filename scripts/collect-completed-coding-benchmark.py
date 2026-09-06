"""GET-only evidence retrieval. Never starts or repeats a benchmark."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://sara-operator-production.up.railway.app'
AUDIENCE = BASE + '/api/coding-benchmark'
ID = '33d94c9a-0de6-41d9-a843-fe9880994242'
TRIAL_RUNTIME = '2c21426a52373cb2982e9759deb7e0f81f98df63'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = urllib.request.build_opener(NoRedirect())

def get(url, credential, maximum):
    request = urllib.request.Request(url, method='GET', headers={
        'Authorization':'Bearer '+credential, 'Accept':'application/json',
        'User-Agent':'SARA-Completed-Trial-Evidence-GET-Only/1'})
    try:
        response = OPENER.open(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(maximum+1)
        if len(raw) > maximum:
            raise ValueError('RESPONSE_BOUND')
        return response.status, raw

def validate(value, expected_runtime, run_id, workflow_sha):
    if value.get('sourceRevision') != expected_runtime or value.get('benchmarkId') != ID:
        raise ValueError('RUNTIME_OR_SCOPE')
    if value.get('ready') is not False or 'BENCHMARK_EXECUTION_ALREADY_CLAIMED' not in value.get('blockers',[]):
        raise ValueError('CONSUMED_CLAIM_REQUIRED')
    if value.get('availableAuthorizationUsd') != 0 or value.get('maximumSpendUsd') != .15:
        raise ValueError('NO_NEW_SPENDING')
    hold = value.get('historicalHold',{})
    if hold != {'benchmarkId':'41267154-ba42-496a-bb79-1656898ac716','unresolvedExposureUsd':.15,'confirmedChargeUsd':None}:
        raise ValueError('HISTORICAL_HOLD_CHANGED')
    if value.get('launcher') != {'authentication':'github_oidc_scoped','benchmarkId':ID,'runId':run_id,
                               'workflowRevision':workflow_sha,'runtimeRevision':expected_runtime}:
        raise ValueError('LAUNCHER_IDENTITY')
    evidence = value.get('executionEvidence',{})
    if evidence.get('status') != 'terminal' or evidence.get('replayAllowed') is not False:
        raise ValueError('TERMINAL_EVIDENCE_REQUIRED')
    files = evidence.get('files')
    if not isinstance(files,list) or not 1 <= len(files) <= 128:
        raise ValueError('EVIDENCE_COUNT')
    output = {}; total = 0
    for item in files:
        path = item.get('path'); content = item.get('content')
        if not isinstance(path,str) or not isinstance(content,str):
            raise ValueError('FILE_SHAPE')
        parsed = PurePosixPath(path)
        if parsed.is_absolute() or '..' in parsed.parts or str(parsed) != path or '\\' in path or not path.endswith('.json') or path in output:
            raise ValueError('UNSAFE_FILE_PATH')
        data = content.encode('utf-8'); total += len(data)
        if len(data) != item.get('bytes') or len(data) > 1048576 or total > 4194304 or hashlib.sha256(data).hexdigest() != item.get('sha256'):
            raise ValueError('FILE_HASH_OR_BOUND')
        output[path] = data
    required = ['manifest.json','execution-claim.json','pairs/0001-luna.json','pairs/0001-luna_reparodynamic.json',
                'pairs/0001-pair.json','trace/owner-launch-claim.json','trace/owner-launch-exit.json','trace/terminal-accounting.json']
    if any(path not in output for path in required):
        raise ValueError('INCOMPLETE_TERMINAL_BUNDLE')
    claim = json.loads(output['trace/owner-launch-claim.json'])['payload']
    if claim.get('sourceRevision') != TRIAL_RUNTIME or claim.get('benchmarkId') != ID:
        raise ValueError('ORIGINAL_EXECUTION_CHANGED')
    return output

def main():
    started = time.monotonic()
    out = Path('/tmp/sara-completed-trial-evidence'); out.mkdir(exist_ok=True)
    metadata = {'retrievalStartedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
                'workflowRevision':os.environ['GITHUB_SHA'],'runId':os.environ['GITHUB_RUN_ID'],
                'retrievalRuntime':os.environ['EXPECTED_RUNTIME'],'trialRuntime':TRIAL_RUNTIME,
                'benchmarkId':ID,'benchmarkPostRequests':0,'modelRequests':0,'purpose':'READ_ONLY_COMPLETED_TRIAL_RECOVERY'}
    (out/'retrieval.json').write_text(json.dumps(metadata,indent=2)+'\n')
    try:
        if os.environ['GITHUB_RUN_ATTEMPT'] != '1':
            raise ValueError('RERUN_REJECTED')
        mint_url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
        if urllib.parse.urlparse(mint_url).scheme != 'https':
            raise ValueError('NON_HTTPS_ISSUER')
        mint_url += ('&' if '?' in mint_url else '?') + urllib.parse.urlencode({'audience':AUDIENCE})
        status, raw = get(mint_url,os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN'],32768)
        if status != 200:
            raise ValueError('TOKEN_MINT_FAILED')
        token = json.loads(raw)['value']
        if not isinstance(token,str) or len(token) > 24000:
            raise ValueError('TOKEN_SHAPE')
        status, raw = get(BASE+'/api/coding-benchmark/readiness',token,25165824)
        # Only the benchmark response is saved. JWTs and all credentials stay in memory.
        (out/'readiness-response.json').write_bytes(raw)
        (out/'http-receipt.json').write_text(json.dumps({'method':'GET','path':'/api/coding-benchmark/readiness',
            'status':status,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)},indent=2)+'\n')
        if status != 200:
            raise ValueError('READINESS_GET_FAILED')
        files = validate(json.loads(raw),os.environ['EXPECTED_RUNTIME'],os.environ['GITHUB_RUN_ID'],os.environ['GITHUB_SHA'])
        for name, data in files.items():
            path = out/'trial'/name; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
        metadata.update({'retrievalComplete':True,'evidenceFiles':len(files),'elapsedMilliseconds':(time.monotonic()-started)*1000})
        (out/'retrieval.json').write_text(json.dumps(metadata,indent=2)+'\n')
        print(json.dumps(metadata))
    except Exception as error:
        metadata.update({'retrievalComplete':False,'failureClass':type(error).__name__,'elapsedMilliseconds':(time.monotonic()-started)*1000})
        (out/'retrieval.json').write_text(json.dumps(metadata,indent=2)+'\n')
        raise SystemExit('Evidence retrieval incomplete; no benchmark was repeated.')

if __name__ == '__main__':
    main()
