// Trusted kernel worker, not a sandbox. Generated source only executes inside
// Genome Lab's unchanged permission-restricted, time-bounded child process.
import { parentPort } from "node:worker_threads";
import { register } from "tsx/esm/api";
register();
const { buildVerifiedSkillCandidate } = await import("./genome-lab.ts");
const { canonicalJson, sha256 } = await import("./canonical.ts");
if (!parentPort) throw new Error("KERNEL_WORKER_REQUIRES_PORT");
let busy = false;
parentPort.on("message", async message => {
  if (busy || !Number.isSafeInteger(message?.id) || message.id < 1 ||
      sha256(canonicalJson(message.input)) !== message.binding) {
    parentPort.postMessage({ protocolError: true }); return;
  }
  busy = true;
  try {
    const { handoff, candidate, candidateId } = message.input;
    const result = await buildVerifiedSkillCandidate(handoff, candidate, message.root, candidateId);
    parentPort.postMessage({ id: message.id, binding: message.binding, drained: true, result });
  } catch {
    parentPort.postMessage({ id: message.id, binding: message.binding, drained: true, failed: true });
  } finally { busy = false; }
});
