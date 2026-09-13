/** Reviewed first-target adapter. Invocation authority belongs to the kernel.
 * The application runs in a fresh, sandboxed browser, using independently
 * fetched public static assets. This is isolated application evidence, not an
 * unrestricted live-site/browser capability or proof of a matching git SHA. */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { constants, createReadStream } from 'node:fs';
import { access, chown, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { request, type RequestOptions } from 'node:https';
import { isIPv4 } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256 } from './canonical.ts';
import { waitForSandboxBrowserEndpoint } from './digital-capabilities/web/sandbox-browser.ts';

const ORIGIN = 'https://nicos-world.com';
const PER_RESOURCE_BYTES = 8 * 1024 * 1024;
const LIFETIME_MS = 60_000;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin";

export function nicosJourneyResourceAllowed(address: string, method: string, resourceType: string): boolean {
  if (method !== 'GET' || address.length > 512 || /[%\\\s]/u.test(address)) return false;
  try {
    const url = new URL(address);
    if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || address !== url.href || url.pathname.includes('//')) return false;
    if (resourceType === 'Document') return url.pathname === '/';
    if (/^\/(?:api|auth|admin|login|logout|account)(?:\/|\.)/iu.test(url.pathname) || /(?:^|\/)(?:sw|service-worker)\.js$/iu.test(url.pathname)) return false;
    const extensions: Record<string, RegExp> = { Script: /^\/assets\/[\w./-]+\.m?js$/u, Stylesheet: /^\/assets\/[\w./-]+\.css$/u, Image: /^\/[\w./-]+\.(?:png|jpe?g|webp|avif|gif|svg|ico)$/iu, Font: /^\/[\w./-]+\.(?:woff2?|ttf|otf)$/iu };
    return extensions[resourceType]?.test(url.pathname) ?? false;
  } catch { return false; }
}

/** IPv4-only transport, with DNS answers pinned into TLS connect. Reject the
 * whole answer set if any address is non-public; DNS rebinding cannot redirect
 * the subsequently opened socket. No IPv6 fallback or caller-supplied lookup. */
export function isPublicJourneyIPv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}

export class JourneyResourceBudget {
  requests = 0;
  bytes = 0;
  constructor(private readonly maxRequests = 180, private readonly maxBytes = 48 * 1024 * 1024) {}
  reserve(): void { if (this.requests >= this.maxRequests) throw new Error('JOURNEY_REQUEST_LIMIT'); this.requests++; }
  consume(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('JOURNEY_INVALID_BYTES');
    if (this.bytes + bytes > this.maxBytes) throw new Error('JOURNEY_TOTAL_BYTES_LIMIT');
    this.bytes += bytes;
  }
}

type JourneyProfileStep = Readonly<{ action: string; selector: string | null; expectedSelector: string; expected: string; attribute?: string }>;
export const NICOS_JOURNEY_PROFILE: readonly JourneyProfileStep[] = Object.freeze([
  { action: 'Observe World Map', selector: null, expectedSelector: '#page-title', expected: 'World Map' },
  { action: 'Continue adventure', selector: '[data-testid="continue-world"]', expectedSelector: '#page-title', expected: 'Robot Home' },
  { action: 'Continue adventure', selector: '.robot-home-system > .world-continue button', expectedSelector: '#page-title', expected: 'Robo Lab' },
  { action: 'Continue to the test chamber', selector: '.robo-lab-test-button', expectedSelector: '#boltbot-mission-title', expected: 'Movement test' },
  { action: 'Forward', selector: 'button[data-route-command="forward"]', expectedSelector: '[data-route-progress]', attribute: 'data-route-progress', expected: '1' },
  { action: 'Right', selector: 'button[data-route-command="right"]', expectedSelector: '[data-route-progress]', attribute: 'data-route-progress', expected: '2' },
  { action: 'Forward', selector: 'button[data-route-command="forward"]', expectedSelector: '[data-route-progress]', attribute: 'data-route-progress', expected: '3' },
  { action: 'Pass movement test', selector: 'button[aria-label="Pass movement test"]', expectedSelector: '#boltbot-mission-title', expected: 'Scanner test' },
].map(step => Object.freeze(step)));

export type JourneyBrowserStartupDiagnostic = {
  classification: 'SANDBOX_UNAVAILABLE' | 'SANDBOX_HELPER_CONFIGURATION' | 'NAMESPACE_UNAVAILABLE' | 'MISSING_LIBRARY' | 'CRASHPAD_FAILURE' | 'ACCESS_DENIED' | 'EXECUTABLE_UNAVAILABLE' | 'RESOURCE_UNAVAILABLE' | 'PROCESS_CRASH' | 'UNKNOWN';
  exitCode: number | null;
  signal: string | null;
  spawnErrorCode: string | null;
  capturedBytes: number;
  truncated: boolean;
  diagnosticDigest: string;
  digestScope: 'BOUNDED_STDERR_PREFIX_AND_EXIT';
};

/** Process output is diagnostic evidence, never instructions. Retain at most
 * 16KiB in memory and emit only a closed classification, safe exit facts and
 * their digest. Raw stderr, paths and arbitrary spawn errors never leave here. */
export class JourneyBrowserStartupDiagnostics {
  #buffer = Buffer.alloc(16 * 1024);
  #bytes = 0;
  #truncated = false;
  #discarded = false;
  append(chunk: Buffer): void {
    if (this.#discarded) return;
    const count = Math.min(chunk.length, this.#buffer.length - this.#bytes);
    chunk.copy(this.#buffer, this.#bytes, 0, count); this.#bytes += count;
    if (count < chunk.length) this.#truncated = true;
  }
  discard(): void { this.#buffer.fill(0); this.#bytes = 0; this.#truncated = false; this.#discarded = true; }
  snapshot(state: { exitCode: number | null; signal: string | null; spawnErrorCode: string | null }): JourneyBrowserStartupDiagnostic {
    const exitCode = Number.isSafeInteger(state.exitCode) && state.exitCode! >= 0 && state.exitCode! <= 255 ? state.exitCode : null;
    const signal = ['SIGABRT','SIGSEGV','SIGILL','SIGBUS','SIGTRAP','SIGKILL','SIGTERM','SIGSYS','SIGHUP','SIGQUIT','SIGXCPU','SIGXFSZ'].includes(state.signal ?? '') ? state.signal : null;
    const spawnErrorCode = state.spawnErrorCode === null ? null : ['ENOENT','EACCES','EPERM','ENOMEM','EAGAIN'].includes(state.spawnErrorCode) ? state.spawnErrorCode : 'UNKNOWN';
    const stderr = this.#buffer.subarray(0, this.#bytes).toString('utf8');
    let classification: JourneyBrowserStartupDiagnostic['classification'] = 'UNKNOWN';
    if (/SUID sandbox helper binary was found, but is not configured correctly/iu.test(stderr)) classification = 'SANDBOX_HELPER_CONFIGURATION';
    else if (/Failed to move to new namespace|Failed to create[^\r\n]*namespace/iu.test(stderr)) classification = 'NAMESPACE_UNAVAILABLE';
    else if (/No usable sandbox|Running as root without --no-sandbox/iu.test(stderr)) classification = 'SANDBOX_UNAVAILABLE';
    else if (/error while loading shared libraries|cannot open shared object file/iu.test(stderr)) classification = 'MISSING_LIBRARY';
    else if (/chrome_crashpad_handler.*(?:required|failed|error|denied)|crashpad.*(?:failed|error|denied)/iu.test(stderr)) classification = 'CRASHPAD_FAILURE';
    else if (spawnErrorCode === 'EACCES' || spawnErrorCode === 'EPERM' || /Permission denied|Access is denied/iu.test(stderr)) classification = 'ACCESS_DENIED';
    else if (spawnErrorCode === 'ENOENT') classification = 'EXECUTABLE_UNAVAILABLE';
    else if (spawnErrorCode === 'ENOMEM' || spawnErrorCode === 'EAGAIN' || /Cannot allocate memory|Resource temporarily unavailable/iu.test(stderr)) classification = 'RESOURCE_UNAVAILABLE';
    else if (signal !== null && ['SIGABRT','SIGSEGV','SIGILL','SIGBUS','SIGTRAP','SIGSYS'].includes(signal)) classification = 'PROCESS_CRASH';
    return { classification, exitCode, signal, spawnErrorCode, capturedBytes: this.#bytes, truncated: this.#truncated, diagnosticDigest: sha256(canonicalJson({ stderrPrefixSha256: sha256(this.#buffer.subarray(0, this.#bytes)), capturedBytes: this.#bytes, truncated: this.#truncated, exitCode, signal, spawnErrorCode })), digestScope: 'BOUNDED_STDERR_PREFIX_AND_EXIT' };
  }
}

export type SoftwareJourneyResult = {
  schemaVersion: 1;
  actor: 'SARA_RUNTIME';
  target: 'https://nicos-world.com/';
  profile: 'nicos-movement-to-scanner-v1';
  provenance: 'ISOLATED';
  assetProvenance: 'EXTERNAL_READ_ONLY';
  status: 'PASSED' | 'INCOMPLETE_EVIDENCE';
  steps: Array<{ action: string; expected: string; observed: string; passed: boolean }>;
  assets: Array<{ url: string; sha256: string; bytes: number; contentType: string }>;
  assetSetDigest: string | null;
  screenshotDigest: string | null;
  servingRevision: null;
  runtimeExceptionCount: number;
  deniedRequestCount: number;
  resourceFailureCount: number;
  fetchedBytes: number;
  elapsedMilliseconds: number;
  failureCode: string | null;
  startupDiagnostics?: JourneyBrowserStartupDiagnostic | null;
  environment: JourneyEnvironmentIdentity;
  limitations: string[];
};

export type JourneyEnvironmentIdentity = {
  platform: string;
  architecture: string;
  nodeVersion: string;
  browserProduct: string | null;
  browserRevision: string | null;
  executableSha256: string | null;
  executableSource: 'PACKAGED' | 'SYSTEM' | 'UNKNOWN';
  packagedBuild: {
    manifestSha256: string;
    version: string;
    archiveSha256: string;
    declaredExecutableSha256: string;
    dependencyManifestSha256: string;
    installedBuildPackagesDigest: string;
  } | null;
  packagedExecutableMatches: boolean | null;
  packagedVersionMatches: boolean | null;
  commandLineDigest: string | null;
  sandboxArgumentsVerified: boolean;
  sandboxDisabled: false;
  liveStateOrCredentialsImported: false;
};

/** Only immutable identity fields leave the build store, never arbitrary
 * manifest text, environment variables, paths or account configuration. */
export function parseJourneyPackagedIdentity(raw: string): NonNullable<JourneyEnvironmentIdentity['packagedBuild']> {
  if (Buffer.byteLength(raw) > 32_768) throw new Error('JOURNEY_BROWSER_MANIFEST_LIMIT');
  let value: any;
  try { value = JSON.parse(raw); } catch { throw new Error('JOURNEY_BROWSER_MANIFEST_INVALID'); }
  const digest = /^[a-f0-9]{64}$/u;
  if (!value || value.schemaVersion !== 1 || value.provenance !== 'BUILD' || !/^\d{1,3}(?:\.\d{1,5}){3}$/u.test(value.version ?? '') || ![value.sha256, value.executableSha256, value.dependencyManifestSha256].every(x => typeof x === 'string' && digest.test(x)) || !Array.isArray(value.installedBuildPackages) || value.installedBuildPackages.length > 100 || value.installedBuildPackages.some((x: unknown) => typeof x !== 'string' || x.length > 256 || !/^[a-z0-9][a-z0-9+.:-]*\t[0-9A-Za-z.+:~_-]+\t[a-z0-9_-]+$/u.test(x))) throw new Error('JOURNEY_BROWSER_MANIFEST_INVALID');
  return { manifestSha256: sha256(raw), version: value.version, archiveSha256: value.sha256, declaredExecutableSha256: value.executableSha256, dependencyManifestSha256: value.dependencyManifestSha256, installedBuildPackagesDigest: sha256(JSON.stringify(value.installedBuildPackages)) };
}

function emptyJourneyEnvironment(): JourneyEnvironmentIdentity {
  return { platform: process.platform, architecture: process.arch, nodeVersion: process.version, browserProduct: null, browserRevision: null, executableSha256: null, executableSource: 'UNKNOWN', packagedBuild: null, packagedExecutableMatches: null, packagedVersionMatches: null, commandLineDigest: null, sandboxArgumentsVerified: false, sandboxDisabled: false, liveStateOrCredentialsImported: false };
}

export async function readSoftwareBrowserConfigurationIdentity(): Promise<string> {
  const environment = emptyJourneyEnvironment();
  const selection = process.env.SARA_SOFTWARE_BROWSER_EXECUTABLE ?? 'google-chrome';
  let failureCode: string | null = null;
  try {
    if (!['google-chrome', 'chromium', 'chromium-browser'].includes(selection)) throw new Error('JOURNEY_UNAPPROVED_BROWSER_EXECUTABLE');
    await identifyJourneyExecutable(selection, environment, AbortSignal.timeout(10_000));
  } catch (error) { failureCode = error instanceof Error && /^JOURNEY_[A-Z_]+$/u.test(error.message) ? error.message : 'JOURNEY_BROWSER_CONFIGURATION_UNAVAILABLE'; }
  return sha256(canonicalJson({ environment, selectionDigest: sha256(selection), failureCode, processUid: process.getuid?.() ?? null, sandboxAvailability: 'UNKNOWN_UNTIL_LAUNCH' }));
}

async function identifyJourneyExecutable(executable: string, identity: JourneyEnvironmentIdentity, signal: AbortSignal): Promise<string> {
  let selected: string | undefined;
  for (const directory of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    try { const candidate = join(directory, executable); await access(candidate, constants.X_OK); selected = await realpath(candidate); break; } catch { /* Search the existing configured PATH without exposing it. */ }
  }
  if (!selected) throw new Error('JOURNEY_BROWSER_UNAVAILABLE');
  const binaryStat = await stat(selected);
  if (!binaryStat.isFile() || binaryStat.size < 1 || binaryStat.size > 512 * 1024 * 1024) throw new Error('JOURNEY_BROWSER_EXECUTABLE_LIMIT');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(selected, { signal })) { bytes += chunk.length; if (bytes > 512 * 1024 * 1024) throw new Error('JOURNEY_BROWSER_EXECUTABLE_LIMIT'); hash.update(chunk); }
  const afterStat = await stat(selected);
  if (bytes !== binaryStat.size || afterStat.size !== binaryStat.size || afterStat.mtimeMs !== binaryStat.mtimeMs || afterStat.ino !== binaryStat.ino) throw new Error('JOURNEY_BROWSER_EXECUTABLE_CHANGED');
  identity.executableSha256 = hash.digest('hex');
  const packagedDirectory = fileURLToPath(new URL('../.cache/software-browser/', import.meta.url));
  let packagedPath: string | null = null;
  try { packagedPath = await realpath(join(packagedDirectory, 'chrome-linux64', 'chrome')); } catch { /* Existing system browser remains supported. */ }
  identity.executableSource = selected === packagedPath ? 'PACKAGED' : 'SYSTEM';
  if (identity.executableSource === 'PACKAGED') {
    const manifestPath = join(packagedDirectory, 'manifest.json');
    if ((await stat(manifestPath)).size > 32_768) throw new Error('JOURNEY_BROWSER_MANIFEST_LIMIT');
    identity.packagedBuild = parseJourneyPackagedIdentity(await readFile(manifestPath, 'utf8'));
    identity.packagedExecutableMatches = identity.executableSha256 === identity.packagedBuild.declaredExecutableSha256;
    if (!identity.packagedExecutableMatches) throw new Error('JOURNEY_BROWSER_EXECUTABLE_HASH_MISMATCH');
  }
  return selected;
}

export function nicosJourneyBrowserArguments(directory: string): string[] {
  return ['--headless=new', '--enable-automation', '--remote-debugging-port=0', `--user-data-dir=${directory}`, '--no-first-run', '--disable-background-networking', '--disable-extensions', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-breakpad', '--no-pings', '--disable-quic', '--disable-dev-shm-usage', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--lang=en-US', 'about:blank'];
}

export function verifyJourneyBrowserCommandLine(value: unknown): string {
  if (!Array.isArray(value) || value.length > 200 || value.some(x => typeof x !== 'string' || x.length > 4096)) throw new Error('JOURNEY_BROWSER_ARGUMENTS_UNVERIFIED');
  const argumentsList = value as string[];
  if (argumentsList.some(x => /^--(?:no-sandbox|disable-setuid-sandbox|disable-seccomp-filter-sandbox|disable-namespace-sandbox|single-process|no-proxy-server|proxy-auto-detect|proxy-pac-url)(?:=|$)/u.test(x))) throw new Error('JOURNEY_BROWSER_SANDBOX_ARGUMENT_DENIED');
  for (const required of ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']) {
    const name = required.split('=')[0]!;
    const matches = argumentsList.filter(x => x === name || x.startsWith(`${name}=`));
    if (matches.length !== 1 || matches[0] !== required) throw new Error('JOURNEY_BROWSER_NETWORK_ARGUMENT_UNVERIFIED');
  }
  return sha256(canonicalJson(argumentsList));
}

/** Root hosts retain the Chrome sandbox by dropping the isolated child to a
 * fixed unprivileged uid. The parent retains ownership of runtime state. */
export function nicosJourneyChildIdentity(platform: string, uid: number | undefined): { uid: number; gid: number } | Record<string, never> {
  return platform === 'linux' && uid === 0 ? { uid: 65534, gid: 65534 } : {};
}

type Asset = { body: Buffer; contentType: string };
export function validateJourneyAssetResponse(status: number | undefined, resourceType: string, headers: { contentType?: string; encoding?: string; length?: string }): string {
  if (status !== 200) throw new Error(status && status >= 300 && status < 400 ? 'JOURNEY_REDIRECT_DENIED' : 'JOURNEY_RESOURCE_HTTP_FAILURE');
  if (headers.encoding && headers.encoding !== 'identity') throw new Error('JOURNEY_ENCODING_UNSUPPORTED');
  const contentType = String(headers.contentType ?? '').split(';')[0]!.toLowerCase();
  const mimeAllowed = resourceType === 'Document' ? contentType === 'text/html' : resourceType === 'Script' ? ['application/javascript', 'text/javascript', 'application/x-javascript'].includes(contentType) : resourceType === 'Stylesheet' ? contentType === 'text/css' : resourceType === 'Image' ? ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(contentType) : resourceType === 'Font' && /^(?:font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-ttf|x-font-opentype|vnd\.ms-fontobject|octet-stream))$/u.test(contentType);
  if (!mimeAllowed) throw new Error('JOURNEY_RESOURCE_TYPE_MISMATCH');
  if (headers.length !== undefined && (!/^\d+$/u.test(headers.length) || !Number.isSafeInteger(Number(headers.length)) || Number(headers.length) > PER_RESOURCE_BYTES)) throw new Error('JOURNEY_RESOURCE_BYTES_LIMIT');
  return contentType;
}
export function nicosJourneyRequestOptions(address: string, resourceType: string, pinnedAddress: string, signal: AbortSignal): RequestOptions {
  if (!nicosJourneyResourceAllowed(address, 'GET', resourceType)) throw new Error('JOURNEY_RESOURCE_DENIED');
  if (!isPublicJourneyIPv4(pinnedAddress)) throw new Error('JOURNEY_DNS_DENIED');
  // Authority is a literal reviewed destination, never a page-provided URL.
  // Only its validated static path crosses the URL-to-request boundary.
  return {
    protocol: 'https:', hostname: 'nicos-world.com', servername: 'nicos-world.com', port: 443,
    path: new URL(address).pathname, method: 'GET', agent: false, signal, timeout: 8000, family: 4,
    lookup: ((_host: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => callback(null, pinnedAddress, 4)) as RequestOptions['lookup'],
    headers: { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'SARA-Bounded-Journey/1.0' },
  };
}

// Fixed declarations are code; selectors, attributes and labels are CDP data.
// No page/request string is quoted, sanitized or interpolated into JavaScript.
const CONTROL_OBSERVATION = `function(selector, action) {
  const candidates = [...document.querySelectorAll(selector)];
  if (candidates.length !== 1) return null;
  const element = candidates[0];
  const label = (element.getAttribute('aria-label') || element.textContent || '').trim();
  if (element.disabled || !label.includes(action) || !element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return null;
  element.scrollIntoView({block:'center',behavior:'instant'});
  const bounds = element.getBoundingClientRect();
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  const hit = document.elementFromPoint(x,y);
  return bounds.width > 0 && bounds.height > 0 && hit && element.contains(hit) ? {x,y} : null;
}`;
const EXPECTATION_OBSERVATION = `function(selector, attribute) {
  const nodes = [...document.querySelectorAll(selector)];
  if (nodes.length !== 1 || !nodes[0].checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return '';
  return String((attribute === null ? nodes[0].textContent : nodes[0].getAttribute(attribute)) || '').trim().slice(0,256);
}`;
export function nicosJourneyObservationCall(kind: 'control' | 'expectation', selector: string, detail: string | null, objectId: string) {
  return { objectId, functionDeclaration: kind === 'control' ? CONTROL_OBSERVATION : EXPECTATION_OBSERVATION,
    arguments: [{ value: selector }, { value: detail }], returnByValue: true };
}

async function fetchAsset(address: string, resourceType: string, budget: JourneyResourceBudget, signal: AbortSignal): Promise<Asset> {
  if (!nicosJourneyResourceAllowed(address, 'GET', resourceType)) throw new Error('JOURNEY_RESOURCE_DENIED');
  budget.reserve();
  const records = await Promise.race([lookup('nicos-world.com', { all: true, family: 4 }), delay(5000, undefined, { signal }).then(() => { throw new Error('JOURNEY_DNS_TIMEOUT'); })]);
  if (!records.length || records.some(record => !isPublicJourneyIPv4(record.address))) throw new Error('JOURNEY_DNS_DENIED');
  const pinnedAddress = records[0]!.address;
  return new Promise<Asset>((resolve, reject) => {
    const call = request(nicosJourneyRequestOptions(address, resourceType, pinnedAddress, signal), response => {
      const fail = (code: string): void => { response.destroy(); call.destroy(); reject(new Error(code)); };
      let contentType: string;
      try { contentType = validateJourneyAssetResponse(response.statusCode, resourceType, { contentType: response.headers['content-type'], encoding: response.headers['content-encoding'], length: response.headers['content-length'] }); }
      catch (error) { fail(error instanceof Error ? error.message : 'JOURNEY_RESOURCE_HTTP_FAILURE'); return; }
      let bytes = 0; const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        try { budget.consume(chunk.length); if (bytes > PER_RESOURCE_BYTES) throw new Error('JOURNEY_RESOURCE_BYTES_LIMIT'); chunks.push(chunk); }
        catch (error) { fail(error instanceof Error ? error.message : 'JOURNEY_RESOURCE_BYTES_LIMIT'); }
      });
      response.once('error', () => reject(new Error('JOURNEY_RESOURCE_STREAM_FAILURE')));
      response.once('end', () => resolve({ body: Buffer.concat(chunks), contentType }));
    });
    call.once('timeout', () => call.destroy(new Error('JOURNEY_RESOURCE_TIMEOUT')));
    call.once('error', error => reject(new Error(/^JOURNEY_[A-Z_]+$/u.test(error.message) ? error.message : 'JOURNEY_RESOURCE_CONNECTION_FAILURE')));
    call.end();
  });
}

type PendingCommand = { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

/** No URL, selectors, code, profile data, cookies or credentials are accepted
 * from a request. The kernel validates the exact target and scope first. */
export async function runNicosMovementJourney(): Promise<SoftwareJourneyResult> {
  const started = performance.now();
  const result: SoftwareJourneyResult = {
    schemaVersion: 1, actor: 'SARA_RUNTIME', target: 'https://nicos-world.com/', profile: 'nicos-movement-to-scanner-v1', provenance: 'ISOLATED', assetProvenance: 'EXTERNAL_READ_ONLY', status: 'INCOMPLETE_EVIDENCE', steps: [], assets: [], assetSetDigest: null, screenshotDigest: null, servingRevision: null, runtimeExceptionCount: 0, deniedRequestCount: 0, resourceFailureCount: 0, fetchedBytes: 0, elapsedMilliseconds: 0, failureCode: null,
    startupDiagnostics: null, environment: emptyJourneyEnvironment(),
    limitations: ['Public static assets run in a new isolated browser profile with external effects blocked; this is not a full live-site integration test.', 'Serving git revision is unknown; static asset hashes must not be equated to a separately observed repository SHA.', 'Only desktop movement-to-scanner transition is tested. Mobile, persisted restart, scanner completion, full mission and other destinations remain untested.', 'Runtime or harness failure is incomplete evidence and does not by itself establish an application defect.', 'Recorded invocation cash does not establish allocated infrastructure expense.'],
  };
  const startupDiagnostics = new JourneyBrowserStartupDiagnostics();
  let startupComplete = false, launchError = false, spawnErrorCode: string | null = null, childClosed: Promise<void> | undefined;
  const budget = new JourneyResourceBudget();
  const controller = new AbortController();
  const pending = new Map<number, PendingCommand>();
  const cache = new Map<string, Promise<Asset>>();
  const activeResources = new Set<Promise<void>>();
  const waitingFetches: Array<() => void> = [];
  let activeFetches = 0;
  const boundedFetch = async (address: string, resourceType: string): Promise<Asset> => {
    if (activeFetches >= 6) await new Promise<void>(resolve => waitingFetches.push(resolve));
    if (closed || controller.signal.aborted) throw new Error('JOURNEY_BROWSER_CLOSED');
    activeFetches++;
    try { return await fetchAsset(address, resourceType, budget, controller.signal); }
    finally { activeFetches--; waitingFetches.shift()?.(); }
  };
  let directory: string | undefined, child: ChildProcess | undefined, socket: WebSocket | undefined, sequence = 0, sessionId: string | undefined, closed = false, interceptedRequests = 0;
  const lifetime = setTimeout(() => { controller.abort(); child?.kill('SIGKILL'); }, LIFETIME_MS);
  const send = (method: string, params: Record<string, unknown> = {}, browserLevel = false, maximumMilliseconds = 5000): Promise<any> => new Promise((resolve, reject) => {
    if (closed || controller.signal.aborted || !socket || socket.readyState !== WebSocket.OPEN) { reject(new Error('JOURNEY_BROWSER_CLOSED')); return; }
    if (socket.bufferedAmount > 16 * 1024 * 1024) { reject(new Error('JOURNEY_PROTOCOL_BYTES_LIMIT')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      // callFunctionOn has no JavaScript evaluation timeout. Preserve the old
      // observation bound by terminating the isolated child on its 1500ms limit.
      if (method === 'Runtime.callFunctionOn') { controller.abort(); child?.kill('SIGKILL'); }
      reject(new Error('JOURNEY_COMMAND_TIMEOUT'));
    }, maximumMilliseconds);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(!browserLevel && sessionId ? { sessionId } : {}) }));
  });
  const observe = async (kind: 'control' | 'expectation', selector: string, detail: string | null): Promise<any> => {
    const global = await send('Runtime.evaluate', { expression: 'globalThis', returnByValue: false, timeout: 1500, disableBreaks: true });
    const objectId = global.result?.objectId;
    if (global.exceptionDetails || typeof objectId !== 'string') throw new Error('JOURNEY_OBSERVATION_FAILED');
    try {
      const evaluated = await send('Runtime.callFunctionOn', nicosJourneyObservationCall(kind, selector, detail, objectId), false, 1500);
      if (evaluated.exceptionDetails) throw new Error('JOURNEY_OBSERVATION_FAILED');
      return evaluated.result?.value;
    } finally {
      if (!controller.signal.aborted) await send('Runtime.releaseObject', { objectId }).catch(() => undefined);
    }
  };
  const capture = async (): Promise<void> => {
    // Fixed target/new profile contains no owner session or supplied sensitive fields.
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (typeof shot.data !== 'string' || shot.data.length > 4 * 1024 * 1024) throw new Error('JOURNEY_SCREENSHOT_LIMIT');
    result.screenshotDigest = sha256(Buffer.from(shot.data, 'base64'));
  };
  const pausedResource = async (params: any): Promise<void> => {
    const { requestId, resourceType, request: incoming } = params;
    if (closed) return;
    if (!incoming || !nicosJourneyResourceAllowed(String(incoming.url), String(incoming.method), String(resourceType))) {
      result.deniedRequestCount++; await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return;
    }
    try {
      const address = String(incoming.url);
      const key = `${resourceType}:${address}`;
      let asset = cache.get(key);
      if (!asset) {
        asset = boundedFetch(address, resourceType);
        cache.set(key, asset);
      }
      const fetched = await asset;
      if (!result.assets.some(entry => entry.url === address)) result.assets.push({ url: address, sha256: sha256(fetched.body), bytes: fetched.body.length, contentType: fetched.contentType });
      await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: fetched.contentType }, { name: 'Cache-Control', value: 'no-store' }, { name: 'Content-Security-Policy', value: CSP }, { name: 'X-Content-Type-Options', value: 'nosniff' }], body: fetched.body.toString('base64') });
    } catch (error) {
      result.resourceFailureCount++;
      if (!result.failureCode) result.failureCode = error instanceof Error && /^JOURNEY_[A-Z_]+$/u.test(error.message) ? error.message : 'JOURNEY_RESOURCE_FAILURE';
      if (!closed) await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => undefined);
    }
  };
  try {
    const executable = process.env.SARA_SOFTWARE_BROWSER_EXECUTABLE ?? 'google-chrome';
    if (!['google-chrome', 'chromium', 'chromium-browser'].includes(executable)) throw new Error('JOURNEY_UNAPPROVED_BROWSER_EXECUTABLE');
    const executablePath = await identifyJourneyExecutable(executable, result.environment, controller.signal);
    directory = await mkdtemp(join(tmpdir(), 'sara-software-journey-'));
    const childIdentity = nicosJourneyChildIdentity(process.platform, process.getuid?.());
    if (childIdentity.uid !== undefined) {
      try { await chown(directory, childIdentity.uid, childIdentity.gid); }
      catch { throw new Error('JOURNEY_BROWSER_USER_ISOLATION_UNAVAILABLE'); }
    }
    child = spawn(executablePath, nicosJourneyBrowserArguments(directory), { ...childIdentity, stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: process.env.PATH, HOME: directory, LANG: 'en_US.UTF-8' } });
    child.stderr!.on('data', (chunk: Buffer) => startupDiagnostics.append(chunk));
    childClosed = new Promise<void>(resolve => child!.once('close', () => resolve()));
    child.on('error', (error: NodeJS.ErrnoException) => { launchError = true; spawnErrorCode = typeof error.code === 'string' ? error.code : 'UNKNOWN'; });
    const endpoint = await waitForSandboxBrowserEndpoint({ read: () => readFile(join(directory!, 'DevToolsActivePort'), 'utf8'), alive: () => !launchError && child!.exitCode === null && child!.signalCode === null, now: () => performance.now(), pause: milliseconds => delay(milliseconds) });
    socket = new WebSocket(`ws://127.0.0.1:${endpoint.port}${endpoint.path}`);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('JOURNEY_BROWSER_CONNECT_TIMEOUT')), 5000);
      socket!.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket!.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('JOURNEY_BROWSER_CONNECTION_FAILED')); }, { once: true });
    });
    socket.addEventListener('message', event => {
      let message: any; try { message = JSON.parse(String(event.data)); } catch { controller.abort(); child?.kill('SIGKILL'); return; }
      if (message.id) {
        const wait = pending.get(message.id); if (!wait) return;
        clearTimeout(wait.timer); pending.delete(message.id);
        if (message.error) wait.reject(new Error('JOURNEY_PROTOCOL_FAILURE')); else wait.resolve(message.result);
      } else if (message.sessionId === sessionId && message.method === 'Fetch.requestPaused') {
        if (++interceptedRequests > 360) {
          result.failureCode ??= 'JOURNEY_REQUEST_LIMIT'; controller.abort(); child?.kill('SIGKILL');
        } else if (activeResources.size >= 180) {
          result.deniedRequestCount++;
          void send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' }).catch(() => undefined);
          result.failureCode ??= 'JOURNEY_CONCURRENT_RESOURCE_LIMIT';
        } else {
          const task = pausedResource(message.params).catch(() => { result.resourceFailureCount++; });
          activeResources.add(task); void task.finally(() => activeResources.delete(task));
        }
      } else if (message.sessionId === sessionId && message.method === 'Runtime.exceptionThrown') result.runtimeExceptionCount++;
    });
    const browserVersion = await send('Browser.getVersion', {}, true);
    if (!/^(?:HeadlessChrome|Chrome|Chromium)\/\d{1,3}(?:\.\d{1,5}){3}$/u.test(browserVersion.product ?? '') || !/^@[a-f0-9]{40}$/u.test(browserVersion.revision ?? '')) throw new Error('JOURNEY_BROWSER_VERSION_UNVERIFIED');
    result.environment.browserProduct = browserVersion.product;
    result.environment.browserRevision = browserVersion.revision;
    const browserCommandLine = await send('Browser.getBrowserCommandLine', {}, true);
    result.environment.commandLineDigest = verifyJourneyBrowserCommandLine(browserCommandLine.arguments);
    result.environment.sandboxArgumentsVerified = true;
    if (result.environment.packagedBuild) {
      result.environment.packagedVersionMatches = browserVersion.product.split('/')[1] === result.environment.packagedBuild.version;
      if (!result.environment.packagedVersionMatches) throw new Error('JOURNEY_BROWSER_VERSION_MISMATCH');
    }
    startupComplete = true; startupDiagnostics.discard();
    const context = await send('Target.createBrowserContext', { disposeOnDetach: true }, true);
    await send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: context.browserContextId }, true);
    const target = await send('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId }, true);
    sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, true)).sessionId;
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Network.setBlockedURLs', { urls: ['ws://*', 'wss://*', 'file://*', 'ftp://*'] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await send('Page.navigate', { url: `${ORIGIN}/` });
    for (const step of NICOS_JOURNEY_PROFILE) {
      if (controller.signal.aborted) throw new Error('JOURNEY_LIFETIME_LIMIT');
      if (step.selector) {
        const controlDeadline = Math.min(started + LIFETIME_MS - 5000, performance.now() + 5000);
        let selected: any = null;
        while (performance.now() < controlDeadline) {
          selected = await observe('control', step.selector, step.action);
          if (selected) break;
          await delay(100, undefined, { signal: controller.signal });
        }
        if (!selected || !Number.isFinite(selected.x) || !Number.isFinite(selected.y)) {
          result.steps.push({ action: step.action, expected: step.expected, observed: 'Expected unique, visible, enabled control unavailable or obscured.', passed: false });
          throw new Error('JOURNEY_CONTROL_UNAVAILABLE');
        }
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: selected.x, y: selected.y });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: selected.x, y: selected.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: selected.x, y: selected.y, button: 'left', clickCount: 1 });
      }
      const deadline = Math.min(started + LIFETIME_MS - 5000, performance.now() + 10_000);
      let observed = '';
      while (performance.now() < deadline) {
        observed = String(await observe('expectation', step.expectedSelector, step.attribute ?? null) ?? '');
        if (observed === step.expected) break;
        await delay(100, undefined, { signal: controller.signal });
      }
      const passed = observed === step.expected;
      result.steps.push({ action: step.action, expected: step.expected, observed, passed });
      if (!passed) throw new Error('JOURNEY_EXPECTATION_NOT_OBSERVED');
    }
    await Promise.allSettled([...activeResources]);
    await capture();
    // A route can pass with optional media deliberately excluded. Resource
    // failures remain visible and limit claims; an uncaught app error blocks
    // qualification even when a heading happened to appear.
    if (result.runtimeExceptionCount) throw new Error('JOURNEY_RUNTIME_EXCEPTION_OBSERVED');
    if (result.failureCode) throw new Error(result.failureCode);
    result.status = 'PASSED';
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (child && !startupComplete) {
      // Let already-exited stderr drain, boundedly. Record exit facts before
      // cleanup kills the child so cleanup cannot masquerade as a crash cause.
      if (launchError || child.exitCode !== null || child.signalCode !== null) await Promise.race([childClosed, delay(100)]);
      result.startupDiagnostics = startupDiagnostics.snapshot({ exitCode: child.exitCode, signal: child.signalCode, spawnErrorCode });
      if (result.startupDiagnostics.classification !== 'UNKNOWN' && (code.startsWith('SANDBOX_BROWSER_') || ['JOURNEY_BROWSER_CONNECTION_FAILED','JOURNEY_BROWSER_CONNECT_TIMEOUT','JOURNEY_BROWSER_CLOSED'].includes(code))) result.failureCode ??= `JOURNEY_BROWSER_${result.startupDiagnostics.classification}`;
    }
    result.failureCode ??= /^JOURNEY_[A-Z_]+$/u.test(code) ? code : /^SANDBOX_BROWSER_/u.test(code) ? 'JOURNEY_BROWSER_UNAVAILABLE' : controller.signal.aborted ? 'JOURNEY_LIFETIME_LIMIT' : 'JOURNEY_ENVIRONMENT_FAILURE';
    if (sessionId && !controller.signal.aborted) await capture().catch(() => undefined);
  } finally {
    startupDiagnostics.discard();
    closed = true; controller.abort(); clearTimeout(lifetime);
    for (const resolve of waitingFetches.splice(0)) resolve();
    for (const wait of pending.values()) { clearTimeout(wait.timer); wait.reject(new Error('JOURNEY_BROWSER_CLOSED')); } pending.clear();
    socket?.close(); child?.kill('SIGKILL');
    await Promise.allSettled([...activeResources]);
    if (child && child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => { const timeout = setTimeout(resolve, 1000); child!.once('exit', () => { clearTimeout(timeout); resolve(); }); });
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => { result.limitations.push('Temporary browser profile cleanup needs host reconciliation.'); });
    result.assets.sort((a, b) => a.url.localeCompare(b.url));
    result.assetSetDigest = result.assets.length ? sha256(canonicalJson(result.assets)) : null;
    result.fetchedBytes = budget.bytes;
    result.elapsedMilliseconds = Math.round(performance.now() - started);
    if (result.status === 'PASSED' && (result.failureCode !== null || result.runtimeExceptionCount > 0 || result.resourceFailureCount > 0)) result.status = 'INCOMPLETE_EVIDENCE';
  }
  return result;
}
