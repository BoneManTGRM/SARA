"""One-off authenticated transport proof. No paid benchmark may be admitted."""
import base64
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://sara-operator-production.up.railway.app'
AUDIENCE = BASE + '/api/coding-benchmark'
BENCHMARK_ID = '41267154-ba42-496a-bb79-1656898ac716'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = urllib.request.build_opener(NoRedirect())

def request(url, token, method='GET', body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
        'Content-Type': 'application/json', 'User-Agent': 'SARA-Owner-Authorized-OIDC-Transport/1'})
    started = time.monotonic()
    try:
        response = OPENER.open(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(32769)
        if len(raw) > 32768:
            raise RuntimeError('RESPONSE_TOO_LARGE')
        return response.status, raw, (time.monotonic() - started) * 1000

def probe(send, env, token, save):
    expected = env['EXPECTED_RUNTIME']
    calls = 0
    for path, method, body, expected_status in [('/api/status', 'GET', None, 401),
                                               ('/api/coding-benchmark/readiness', 'GET', None, 200)]:
        status, raw, elapsed = send(BASE + path, token, method, body)
        calls += 1
        receipt = {'path': path, 'method': method, 'httpStatus': status,
                   'responseSHA256': hashlib.sha256(raw).hexdigest(), 'elapsedMilliseconds': elapsed}
        # Do not persist any unexpected private status response.
        save('request-' + str(calls) + '.json', receipt)
        if status != expected_status:
            raise RuntimeError('UNEXPECTED_HTTP_STATUS_' + str(status))
    ready = json.loads(raw)
    sanitized = {k: ready.get(k) for k in ['ready', 'blockers', 'sourceRevision', 'benchmarkId',
        'maximumSpendUsd', 'maximumModelSpendUsdPerArm', 'unresolvedExposureUsd', 'confirmedChargeUsd',
        'availableAuthorizationUsd', 'authorityDigest', 'model', 'reasoning', 'maximumAttemptsPerArm',
        'order', 'compactOutput', 'compilerCaching', 'launcher', 'authenticatedLaunchPath', 'execution']}
    save('authenticated-readiness.json', sanitized)
    # ALL assertions precede POST. In particular an unexpectedly cleared grant
    # MUST abort, never turn this connectivity check into paid execution.
    assert ready['ready'] is False
    assert ready['blockers'] == ['UNRECONCILED_MODEL_EXPOSURE']
    assert ready['sourceRevision'] == expected and ready['benchmarkId'] == BENCHMARK_ID
    assert ready['maximumSpendUsd'] == .15 and ready['maximumModelSpendUsdPerArm'] == .075
    assert ready['unresolvedExposureUsd'] == .15 and ready['availableAuthorizationUsd'] == 0
    assert ready['confirmedChargeUsd'] is None
    assert ready['model'] == 'gpt-5.6-luna' and ready['reasoning'] == 'medium'
    assert ready['maximumAttemptsPerArm'] == 3 and ready['order'] == ['luna_reparodynamic', 'luna']
    assert ready['compactOutput'] is False and ready['compilerCaching'] is False
    assert ready['authenticatedLaunchPath'] == '/api/coding-benchmark/run'
    assert ready['launcher'] == {'authentication':'github_oidc_scoped', 'benchmarkId':BENCHMARK_ID,
        'runId':env['GITHUB_RUN_ID'], 'workflowRevision':env['GITHUB_SHA'], 'runtimeRevision':expected}
    digest = ready['authorityDigest']
    assert isinstance(digest, str) and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest)
    body = {'benchmarkId':BENCHMARK_ID, 'sourceRevision':expected, 'authorityDigest':digest}
    status, raw, elapsed = send(BASE + '/api/coding-benchmark/run', token, 'POST', body)
    error = json.loads(raw)
    save('request-3.json', {'path':'/api/coding-benchmark/run', 'method':'POST', 'httpStatus':status,
        'responseSHA256':hashlib.sha256(raw).hexdigest(), 'elapsedMilliseconds':elapsed,
        'errorCode':error.get('code'), 'benchmarkExecutionRequested':False, 'rejectionOnly':True})
    assert status == 423 and error.get('code') == 'UNRECONCILED_MODEL_EXPOSURE'
    return {'authenticatedConnectionVerified':True, 'otherOwnerApiDenied':True,
            'paidAdmissionRejected':True, 'benchmarkReady':False, 'modelRequestsIssuedByProbe':0,
            'originalExposureUsd':.15, 'httpRequestsToSARA':3}

def main():
    out = Path('/tmp/sara-relay-live-proof'); out.mkdir(exist_ok=True)
    def save(name, payload):
        (out / name).write_text(json.dumps(payload, indent=2)+'\n')
    started = time.monotonic()
    save('execution.json', {'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
        'runtimeRevision':os.environ['EXPECTED_RUNTIME'], 'workflowRevision':os.environ['GITHUB_SHA'],
        'runId':os.environ['GITHUB_RUN_ID'], 'runAttempt':os.environ['GITHUB_RUN_ATTEMPT'],
        'evidenceScope':'AUTHENTICATED_TRANSPORT_AND_DENIAL_ONLY'})
    try:
        assert os.environ['GITHUB_RUN_ATTEMPT'] == '1'
        url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
        assert urllib.parse.urlparse(url).scheme == 'https'
        url += ('&' if '?' in url else '?') + urllib.parse.urlencode({'audience':AUDIENCE})
        status, raw, elapsed = request(url, os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN'])
        assert status == 200
        token = json.loads(raw)['value']
        assert isinstance(token, str) and len(token) < 24000
        # These non-secret identity claims help diagnose issuer changes. Never save
        # the JWT, signature, nonce, authorization header, or minting credential.
        encoded = token.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(encoded + '='*((-len(encoded))%4)))
        save('issuer-identity.json', {k:claims.get(k) for k in ['iss','aud','sub','repository','repository_id',
            'repository_owner_id','actor_id','ref','ref_type','workflow_ref','workflow_sha','sha',
            'event_name','run_attempt','run_id','runner_environment','iat','nbf','exp']})
        result = probe(request, os.environ, token, save)
        result['elapsedMilliseconds'] = (time.monotonic()-started)*1000
        result['includes'] = 'OIDC minting, three network requests, validation and evidence writes'
        result['excludes'] = 'workflow queue/provisioning, source setup, CI, deployment, upload/download and audit'
        save('result.json', result)
        print(json.dumps(result))
    except Exception as error:
        save('failure.json', {'kind':type(error).__name__, 'elapsedMilliseconds':(time.monotonic()-started)*1000,
                              'paidBenchmarkNotAuthorized':True})
        raise SystemExit('Authenticated transport proof did not complete; see sanitized evidence.')

if __name__ == '__main__':
    main()
