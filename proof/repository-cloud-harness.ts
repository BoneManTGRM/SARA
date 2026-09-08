import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { RepositoryCloudBroker } from "../src/repository-cloud-broker.ts";
import { createRepositoryCloudWorkerEngine, runRepositoryCloudWorker } from "../src/repository-cloud-worker.ts";
import type { RepositoryEnvironment, RepositoryTask } from "../src/repository-executor.ts";

/** Explicit zero-cost fixture authority. This loopback proof cannot activate the
 * deployed service, claim a model grant, or attest real GitHub OIDC connectivity. */
export async function repositoryCloudProofHarness(directory: string) {
  const broker = new RepositoryCloudBroker({ assertAuthority: async () => {} });
  await broker.begin(join(directory, "cloud-transport"));
  const fixtureToken = randomUUID();
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${fixtureToken}` || request.method !== "POST") throw Error("PROOF_AUTH");
      const parts: Buffer[] = []; let bytes = 0;
      for await (const part of request) { const chunk = Buffer.from(part); bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) throw Error("PROOF_BODY"); parts.push(chunk); }
      const result = await broker.worker({ authentication: "github_oidc_repository_worker", benchmarkId: "zero-cost-fixture-only",
        registrationDigest: "a".repeat(64), workflowRevision: "b".repeat(40), runId: "1" }, JSON.parse(Buffer.concat(parts).toString("utf8")));
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(result));
    } catch { response.writeHead(403); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("PROOF_ADDRESS");
  let worker: Promise<void> | undefined, controller: AbortController | undefined;
  return {
    broker,
    async start(environment: RepositoryEnvironment, task: RepositoryTask) {
      await broker.openAssignment({ phase: "producer", attemptId: `${task.instanceId}-${task.arm}`, environment, task });
      controller = new AbortController();
      worker = runRepositoryCloudWorker({ phase: "producer", signal: controller.signal,
        pause: () => new Promise(resolve => setTimeout(resolve, 10)),
        async call(body) {
          const r = await fetch(`http://127.0.0.1:${address.port}`, { method: "POST", headers: { authorization: `Bearer ${fixtureToken}` },
            body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
          if (!r.ok) throw Error("PROOF_TRANSPORT_REJECTED"); return r.json();
        },
        async prepare(assignment) {
          const root = join(directory, `worker-${assignment.id}`); await mkdir(root);
          return createRepositoryCloudWorkerEngine({ assignment, directory: root });
        },
      });
      void worker.catch(() => {});
    },
    async finish() { await broker.finishAssignment(); await worker; worker = undefined; },
    async close() {
      broker.end(); controller?.abort(); await worker?.catch(() => {});
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
