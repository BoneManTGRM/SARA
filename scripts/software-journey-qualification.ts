/** Actual external-read-only asset collection and isolated browser execution.
 * May also validate the actual journey receipt from the owner UI qualification
 * without dispatching a second journey. There are no synthetic fallback assets. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson, sha256 } from '../src/canonical.ts';
import { runNicosMovementJourney, type SoftwareJourneyResult } from '../src/software-journey-browser.ts';

export function assertNicosJourneyQualification(value: unknown, requirePackaged = false): asserts value is SoftwareJourneyResult {
  assert.ok(value && typeof value === 'object');
  const result = value as SoftwareJourneyResult;
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.actor, 'SARA_RUNTIME');
  assert.equal(result.target, 'https://nicos-world.com/');
  assert.equal(result.profile, 'nicos-movement-to-scanner-v1');
  assert.equal(result.provenance, 'ISOLATED');
  assert.equal(result.assetProvenance, 'EXTERNAL_READ_ONLY');
  assert.equal(result.status, 'PASSED', `Actual browser qualification incomplete: ${result.failureCode}`);
  assert.equal(result.failureCode, null);
  assert.equal(result.runtimeExceptionCount, 0);
  assert.equal(result.resourceFailureCount, 0);
  assert.equal(result.servingRevision, null, 'No serving git attestation is implemented by this profile.');
  assert.ok(Number.isSafeInteger(result.deniedRequestCount) && result.deniedRequestCount >= 0);
  const expected = [
    ['Observe World Map', 'World Map'], ['Continue adventure', 'Robot Home'], ['Continue adventure', 'Robo Lab'],
    ['Continue to the test chamber', 'Movement test'], ['Forward', '1'], ['Right', '2'], ['Forward', '3'], ['Pass movement test', 'Scanner test'],
  ];
  assert.equal(result.steps?.length, expected.length);
  for (const [index, [action, observation]] of expected.entries()) assert.deepEqual(result.steps[index], { action, expected: observation, observed: observation, passed: true });
  assert.match(result.screenshotDigest ?? '', /^[a-f0-9]{64}$/u);
  assert.ok(Array.isArray(result.assets) && result.assets.length >= 2 && result.assets.length <= 180);
  assert.equal(new Set(result.assets.map(asset => asset.url)).size, result.assets.length);
  assert.ok(result.assets.some(asset => asset.url === 'https://nicos-world.com/' && asset.contentType === 'text/html'));
  assert.ok(result.assets.some(asset => /^https:\/\/nicos-world\.com\/assets\/[\w./-]+\.m?js$/u.test(asset.url) && ['text/javascript', 'application/javascript', 'application/x-javascript'].includes(asset.contentType)));
  for (const asset of result.assets) {
    const url = new URL(asset.url);
    assert.equal(url.origin, 'https://nicos-world.com');
    assert.equal(url.username + url.password + url.search + url.hash, '');
    assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && asset.bytes <= 8 * 1024 * 1024);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
  }
  assert.equal(result.assetSetDigest, sha256(canonicalJson(result.assets)));
  assert.equal(result.assets.reduce((sum, asset) => sum + asset.bytes, 0), result.fetchedBytes);
  assert.ok(result.fetchedBytes <= 48 * 1024 * 1024);
  assert.ok(Number.isSafeInteger(result.elapsedMilliseconds) && result.elapsedMilliseconds > 0 && result.elapsedMilliseconds < 75_000);
  assert.ok(result.environment);
  assert.match(result.environment.browserProduct ?? '', /^(?:HeadlessChrome|Chrome|Chromium)\/\d{1,3}(?:\.\d{1,5}){3}$/u);
  assert.match(result.environment.browserRevision ?? '', /^@[a-f0-9]{40}$/u);
  assert.match(result.environment.executableSha256 ?? '', /^[a-f0-9]{64}$/u);
  assert.equal(result.environment.sandboxDisabled, false);
  assert.equal(result.environment.sandboxArgumentsVerified, true);
  assert.match(result.environment.commandLineDigest ?? '', /^[a-f0-9]{64}$/u);
  assert.equal(result.environment.liveStateOrCredentialsImported, false);
  if (requirePackaged || result.environment.executableSource === 'PACKAGED') {
    assert.equal(result.environment.executableSource, 'PACKAGED');
    assert.equal(result.environment.packagedExecutableMatches, true);
    assert.equal(result.environment.packagedVersionMatches, true);
    assert.equal(result.environment.packagedBuild?.declaredExecutableSha256, result.environment.executableSha256);
    assert.match(result.environment.packagedBuild?.manifestSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.match(result.environment.packagedBuild?.archiveSha256 ?? '', /^[a-f0-9]{64}$/u);
  } else assert.equal(result.environment.executableSource, 'SYSTEM');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(arg => arg !== '--require-packaged')) throw new Error('Only --require-packaged is supported.');
  const result = await runNicosMovementJourney();
  const reportPath = resolve('reports/software-journey-qualification.json');
  await mkdir(resolve('reports'), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ provenance: process.env.GITHUB_ACTIONS === 'true' ? 'CI' : 'LOCAL', synthetic: false, invocationActor: 'IMPLEMENTATION_QUALIFICATION', executionActor: 'SARA_RUNTIME_ADAPTER', result, resultDigest: sha256(canonicalJson(result)) }, null, 2)}\n`, { mode: 0o600 });
  assertNicosJourneyQualification(result, process.argv.includes('--require-packaged'));
  console.log(JSON.stringify({ qualified: true, provenance: 'ISOLATED', synthetic: false, steps: result.steps.length, assets: result.assets.length, assetSetDigest: result.assetSetDigest, screenshotDigest: result.screenshotDigest, report: 'reports/software-journey-qualification.json' }));
}
