import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nicosJourneyResourceAllowed, isPublicJourneyIPv4, JourneyResourceBudget, NICOS_JOURNEY_PROFILE, nicosJourneyBrowserArguments, nicosJourneyChildIdentity, validateJourneyAssetResponse, parseJourneyPackagedIdentity, verifyJourneyBrowserCommandLine, nicosJourneyRequestOptions, nicosJourneyObservationCall, JourneyBrowserStartupDiagnostics } from '../src/software-journey-browser.ts';

test('outbound request fixes TLS authority and permits only the validated static path with a public pinned address',()=>{
  const signal=new AbortController().signal;
  const options=nicosJourneyRequestOptions('https://nicos-world.com/assets/app-123.js','Script','104.21.12.34',signal);
  assert.equal(options.protocol,'https:');assert.equal(options.hostname,'nicos-world.com');assert.equal(options.servername,'nicos-world.com');assert.equal(options.port,443);
  assert.equal(options.path,'/assets/app-123.js');assert.equal(options.method,'GET');assert.equal(options.agent,false);assert.equal(options.signal,signal);
  assert.equal('auth' in options,false);
  for(const address of ['https://evil.test/assets/app.js','https://nicos-world.com@127.0.0.1/assets/app.js','https://nicos-world.com/assets/app.js?target=169.254.169.254','https://nicos-world.com//evil.test/app.js','https://nicos-world.com/assets/../api/test.js'])assert.throws(()=>nicosJourneyRequestOptions(address,'Script','104.21.12.34',signal),/RESOURCE_DENIED/);
  for(const address of ['127.0.0.1','169.254.169.254','::ffff:8.8.8.8'])assert.throws(()=>nicosJourneyRequestOptions('https://nicos-world.com/','Document',address,signal),/DNS_DENIED/);
  let observed='';
  (options.lookup as Function)('untrusted-lookup-argument.test',{},(error:Error|null,address:string,family:number)=>{assert.equal(error,null);assert.equal(family,4);observed=address;});
  assert.equal(observed,'104.21.12.34');
});

test('browser observation declarations remain static while hostile selectors and labels travel only as protocol arguments',()=>{
  const hostile='\");globalThis.untrustedExecuted=true;//';
  for(const kind of ['control','expectation'] as const){
    const baseline=nicosJourneyObservationCall(kind,'#page-title','World Map','isolated-global');
    const candidate=nicosJourneyObservationCall(kind,hostile,hostile,'isolated-global');
    assert.equal(candidate.functionDeclaration,baseline.functionDeclaration);
    assert.equal(candidate.functionDeclaration.includes(hostile),false);
    assert.deepEqual(candidate.arguments,[{value:hostile},{value:hostile}]);
    assert.equal(candidate.objectId,'isolated-global');assert.equal(candidate.returnByValue,true);
    assert.equal('expression' in candidate,false);
  }
});

test('journey fetch permits only reviewed static GET resources on the exact target', () => {
  for (const [url, kind] of [['https://nicos-world.com/', 'Document'], ['https://nicos-world.com/assets/index-Ab123.js', 'Script'], ['https://nicos-world.com/assets/index-Ab123.css', 'Stylesheet'], ['https://nicos-world.com/art/robot.webp', 'Image'], ['https://nicos-world.com/fonts/font.woff2', 'Font']]) {
    assert.equal(nicosJourneyResourceAllowed(url!, 'GET', kind!), true);
  }
});
test('journey denies submissions, APIs, credential URLs, external origins and ambiguous paths', () => {
  for (const [url, method, kind] of [
    ['https://nicos-world.com/', 'POST', 'Document'], ['https://nicos-world.com/api/profile', 'GET', 'Fetch'],
    ['https://nicos-world.com/api/delete.js', 'GET', 'Script'], ['https://evil.test/a.js', 'GET', 'Script'],
    ['https://user:secret@nicos-world.com/a.js', 'GET', 'Script'], ['http://nicos-world.com/a.js', 'GET', 'Script'],
    ['https://nicos-world.com/a.js?token=secret', 'GET', 'Script'], ['https://nicos-world.com/%2e%2e/a.js', 'GET', 'Script'],
    ['https://nicos-world.com/a/../delete.js', 'GET', 'Script'], ['https://nicos-world.com/a.js', 'GET', 'XHR'],
    ['https://nicos-world.com/a.js', 'GET', 'WebSocket'], ['https://nicos-world.com/', 'GET', 'Script'],
    ['https://nicos-world.com/sw.js', 'GET', 'Script'], ['https://nicos-world.com:444/a.js', 'GET', 'Script'],
    ['https://nicos-world.com//evil.js', 'GET', 'Script'], ['https://nicos-world.com/a.js#x', 'GET', 'Script'],
  ]) assert.equal(nicosJourneyResourceAllowed(url!, method!, kind!), false, url);
});
test('journey DNS pin rejects private, metadata, mapped, reserved and noncanonical addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.1.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.100.100.200', '0.0.0.0', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.1.1.1', '255.255.255.255', '::1', '::ffff:8.8.8.8', '008.8.8.8', '8.8.8.999', '8.8.8']) assert.equal(isPublicJourneyIPv4(ip), false, ip);
  assert.equal(isPublicJourneyIPv4('104.21.12.34'), true);
  assert.equal(isPublicJourneyIPv4('8.8.8.8'), true);
});
test('resource budgets count failed attempts and enforce aggregate response bytes', () => {
  const budget = new JourneyResourceBudget(2, 5);
  budget.reserve(); budget.reserve(); assert.throws(() => budget.reserve(), /REQUEST_LIMIT/);
  budget.consume(3); budget.consume(2); assert.throws(() => budget.consume(1), /TOTAL_BYTES_LIMIT/);
  assert.throws(() => budget.consume(-1), /INVALID_BYTES/);
  assert.equal(budget.requests, 2); assert.equal(budget.bytes, 5);
});
test('reviewed route preserves movement order and a scanner assertion without owner scripts', () => {
  assert.deepEqual(NICOS_JOURNEY_PROFILE.map(x => x.action), ['Observe World Map', 'Continue adventure', 'Continue adventure', 'Continue to the test chamber', 'Forward', 'Right', 'Forward', 'Pass movement test']);
  assert.equal(NICOS_JOURNEY_PROFILE.at(-1)?.expected, 'Scanner test');
  assert.equal(Object.isFrozen(NICOS_JOURNEY_PROFILE), true);
});
test('browser retains sandbox and makes direct networking unusable even for literal loopback', () => {
  const args = nicosJourneyBrowserArguments('/tmp/sara-profile');
  assert.equal(args.some(x => x === '--no-sandbox' || x === '--disable-setuid-sandbox'), false);
  assert.ok(args.includes('--proxy-server=http://127.0.0.1:9'));
  assert.ok(args.includes('--proxy-bypass-list=<-loopback>'));
  assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND'));
  assert.ok(args.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'));
});
test('root Linux host launches browser as a fixed unprivileged child only', () => {
  assert.deepEqual(nicosJourneyChildIdentity('linux', 0), { uid: 65534, gid: 65534 });
  assert.deepEqual(nicosJourneyChildIdentity('linux', 1000), {});
  assert.deepEqual(nicosJourneyChildIdentity('win32', undefined), {});
});
test('asset response validation denies redirects, wrong MIME, compression and excessive or malformed lengths', () => {
  assert.equal(validateJourneyAssetResponse(200, 'Document', { contentType: 'text/html; charset=utf-8', length: '1024' }), 'text/html');
  for (const status of [301, 302, 303, 307, 308]) assert.throws(() => validateJourneyAssetResponse(status, 'Document', {}), /REDIRECT_DENIED/);
  assert.throws(() => validateJourneyAssetResponse(200, 'Script', { contentType: 'text/html' }), /TYPE_MISMATCH/);
  assert.throws(() => validateJourneyAssetResponse(200, 'Document', { contentType: 'text/html', encoding: 'gzip' }), /ENCODING_UNSUPPORTED/);
  for (const length of ['-1', 'NaN', '999999999', '9007199254740992']) assert.throws(() => validateJourneyAssetResponse(200, 'Document', { contentType: 'text/html', length }), /BYTES_LIMIT/);
});
test('packaged browser identity preserves hashes without exposing arbitrary manifest contents', () => {
  const source = { schemaVersion: 1, provenance: 'BUILD', version: '153.0.8010.36', sha256: 'a'.repeat(64), executableSha256: 'b'.repeat(64), dependencyManifestSha256: 'c'.repeat(64), installedBuildPackages: ['libc6\t2.39-0ubuntu8.6\tamd64'], unexpectedSecret: 'do-not-emit' };
  const parsed = parseJourneyPackagedIdentity(JSON.stringify(source));
  assert.equal(parsed.archiveSha256, source.sha256);
  assert.equal(parsed.declaredExecutableSha256, source.executableSha256);
  assert.equal(parsed.version, source.version);
  assert.match(parsed.manifestSha256, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(parsed).includes('do-not-emit'), false);
  for (const patch of [{ sha256: 'invalid' }, { version: 'arbitrary external text' }, { provenance: 'MODEL_GENERATED' }, { installedBuildPackages: ['token=secret'] }]) assert.throws(() => parseJourneyPackagedIdentity(JSON.stringify({ ...source, ...patch })), /MANIFEST_INVALID/);
  assert.throws(() => parseJourneyPackagedIdentity(' '.repeat(32769)), /MANIFEST_LIMIT/);
});
test('observed browser command line rejects sandbox bypass and duplicate network overrides', () => {
  const args = nicosJourneyBrowserArguments('/tmp/isolated-profile');
  assert.match(verifyJourneyBrowserCommandLine(args), /^[a-f0-9]{64}$/u);
  for (const forbidden of ['--no-sandbox', '--disable-setuid-sandbox', '--disable-seccomp-filter-sandbox', '--single-process', '--no-proxy-server', '--proxy-pac-url=https://example.com/config']) assert.throws(() => verifyJourneyBrowserCommandLine([...args, forbidden]), /SANDBOX_ARGUMENT_DENIED/);
  assert.throws(() => verifyJourneyBrowserCommandLine([...args, '--proxy-server=http://other.test']), /NETWORK_ARGUMENT_UNVERIFIED/);
  assert.throws(() => verifyJourneyBrowserCommandLine(args.filter(x => !x.startsWith('--host-resolver-rules='))), /NETWORK_ARGUMENT_UNVERIFIED/);
});


test('browser startup diagnostics classify fixed launch symptoms without returning raw stderr or secrets',()=>{
 const cases=[['No usable sandbox!','SANDBOX_UNAVAILABLE'],['Failed to move to new namespace: Operation not permitted','NAMESPACE_UNAVAILABLE'],['Failed to create a new namespace: Operation not permitted','NAMESPACE_UNAVAILABLE'],['The SUID sandbox helper binary was found, but is not configured correctly. /private/synthetic-secret/chrome-sandbox','SANDBOX_HELPER_CONFIGURATION'],['error while loading shared libraries: libX.so: cannot open shared object file','MISSING_LIBRARY'],['chrome_crashpad_handler: --database is required','CRASHPAD_FAILURE'],['open /private/secret: Permission denied','ACCESS_DENIED'],['unrecognized environment failure token=synthetic-secret','UNKNOWN']] as const;
 for(const [message,classification] of cases){const diagnostics=new JourneyBrowserStartupDiagnostics();diagnostics.append(Buffer.from(message+' token=synthetic-secret'));const report=diagnostics.snapshot({exitCode:1,signal:null,spawnErrorCode:null});assert.equal(report.classification,classification);assert.equal(report.exitCode,1);assert.match(report.diagnosticDigest,/^[a-f0-9]{64}$/u);assert.equal(JSON.stringify(report).includes('synthetic-secret'),false);assert.equal(JSON.stringify(report).includes('/private'),false);}
 const diagnostics=new JourneyBrowserStartupDiagnostics();assert.equal(diagnostics.snapshot({exitCode:null,signal:'SIGSEGV',spawnErrorCode:null}).classification,'PROCESS_CRASH');assert.equal(diagnostics.snapshot({exitCode:null,signal:null,spawnErrorCode:'EACCES'}).classification,'ACCESS_DENIED');assert.equal(diagnostics.snapshot({exitCode:null,signal:null,spawnErrorCode:'SECRET_PATH'}).spawnErrorCode,'UNKNOWN');
});
test('startup diagnostics cap retained bytes at 16KiB, preserve chunk identity and never infer from discarded output',()=>{
 const first=new JourneyBrowserStartupDiagnostics(),second=new JourneyBrowserStartupDiagnostics(),state={exitCode:1,signal:null,spawnErrorCode:null};
 first.append(Buffer.alloc(16384,120));first.append(Buffer.from('No usable sandbox! synthetic-secret'));
 second.append(Buffer.alloc(8192,120));second.append(Buffer.alloc(8192,120));second.append(Buffer.from('different discarded suffix'));
 const a=first.snapshot(state),b=second.snapshot(state);assert.equal(a.capturedBytes,16384);assert.equal(a.truncated,true);assert.equal(a.classification,'UNKNOWN');assert.equal(a.diagnosticDigest,b.diagnosticDigest);
 first.discard();first.append(Buffer.from('Permission denied'));assert.equal(first.snapshot(state).capturedBytes,0);
});
