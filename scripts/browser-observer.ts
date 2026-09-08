import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { browserObserverAuthorized, browserRequestAllowed } from "../src/browser-observer.ts";
import { requestGithubOidcToken } from "../src/site-executor-client.ts";

if (!browserObserverAuthorized(process.env)) throw new Error("Only a fresh owner-started main-branch public-repository browser check is permitted.");
const token = await requestGithubOidcToken();
const profile = await mkdtemp(join(tmpdir(), "sara-browser-"));
// Do not forward workflow tokens to Chrome or disable its sandbox.
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-background-networking", "--disable-extensions", "about:blank"], {
  stdio: "ignore", env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "en_US.UTF-8" },
});
let launchError = false;
chrome.on("error", () => { launchError = true; });
let socket: WebSocket | undefined; let started = false;
const killTimer = setTimeout(() => chrome.kill("SIGKILL"), 120000);
async function publish(kind: string, body: unknown = {}) {
  const response = await fetch(`https://saraseed.app/api/executor/browser/${kind}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(8000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Browser ${kind} receipt rejected: HTTP ${response.status}.`);
  return response.json();
}
try {
  let portFile = "";
  for (let attempt = 0; attempt < 50; attempt++) {
    if (launchError || chrome.exitCode !== null) throw new Error("Existing runner Chrome could not start.");
    try { portFile = await readFile(join(profile, "DevToolsActivePort"), "utf8"); break; } catch { await delay(100); }
  }
  const [port, path] = portFile.trim().split("\n");
  if (!/^\d{1,5}$/.test(port ?? "") || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(path ?? "")) throw new Error("Local browser endpoint unavailable.");
  socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Browser connection timed out.")), 5000);
    socket!.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket!.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Browser connection failed.")); }, { once: true });
  });
  let nextId = 0;
  let sessionId: string | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  function command(method: string, params: Record<string, unknown> = {}, session = sessionId): Promise<any> {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 8000);
      pending.set(id, { resolve, reject, timer });
      socket!.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const wait = pending.get(message.id); if (!wait) return;
      pending.delete(message.id); clearTimeout(wait.timer);
      if (message.error) wait.reject(new Error("Browser protocol command failed.")); else wait.resolve(message.result);
    } else if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const allowed = browserRequestAllowed(request.url, request.method);
      void command(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", { requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}) }).catch(() => chrome.kill());
    }
  });
  const target = await command("Target.createTarget", { url: "about:blank" });
  const attached = await command("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  sessionId = attached.sessionId;
  await command("Page.enable");
  await command("Network.enable");
  await command("Network.setBypassServiceWorker", { bypass: true });
  await command("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await command("Emulation.setDeviceMetricsOverride", { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });
  await publish("start"); started = true;
  let sequence = 0;
  for (const page of ["https://saraseed.app/", "https://saraseed.app/pilot"]) {
    const navigation = await command("Page.navigate", { url: page });
    if (navigation.errorText) throw new Error("Public page navigation failed.");
    let rendered = false;
    for (let check = 0; check < 20; check++) {
      const result = await command("Runtime.evaluate", { expression: "Boolean(document.querySelector('h1') && document.readyState !== 'loading')", returnByValue: true });
      if (result.result?.value === true) { rendered = true; break; }
      await delay(250);
    }
    if (!rendered) throw new Error("Public page did not render its heading.");
    for (let frame = 0; frame < 15; frame++) {
      if (frame === 8) await command("Runtime.evaluate", { expression: "window.scrollBy(0, 320)" });
      const captured = await command("Page.captureScreenshot", { format: "jpeg", quality: 45, captureBeyondViewport: false });
      if (typeof captured.data !== "string" || captured.data.length > 140000) throw new Error("Browser frame exceeds the observation bound.");
      await publish("frame", { sequence: ++sequence, capturedAt: new Date().toISOString(), image: captured.data });
      await delay(2000);
    }
    console.log(`Public-page rendering verified; ${sequence} browser frames acknowledged.`);
  }
} finally {
  if (started) await publish("end").catch(() => console.error("Browser closure receipt unavailable; the session will expire automatically."));
  socket?.close(); chrome.kill("SIGKILL"); clearTimeout(killTimer);
  await rm(profile, { recursive: true, force: true });
}
