import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nicosJourneyResourceAllowed, isPublicJourneyIPv4, JourneyResourceBudget, NICOS_JOURNEY_PROFILE, nicosJourneyBrowserArguments, nicosJourneyChildIdentity, validateJourneyAssetResponse, parseJourneyPackagedIdentity, verifyJourneyBrowserCommandLine } from '../src/software-journey-browser.ts';

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
