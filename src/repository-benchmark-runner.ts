import { canonicalJson, sha256 } from "./canonical.ts";
import { writeBenchmarkAudit } from "./coding-benchmark-audit.ts";
import { createBenchmarkDispatchBudget } from "./benchmark-dispatch-budget.ts";
import { SaraKernel, SARA_PRINCIPAL } from "./kernel.ts";
import type { Principal } from "./types.ts";
import type { RepositoryBenchmarkRegistration } from "./repository-benchmark-permit.ts";
import { repositoryBinding } from "./repository-executor.ts";
import { createRepositoryProducerSandbox, runRepositoryProducer, type RepositoryProducerResult } from "./repository-producer.ts";
import { createRepositoryLunaModel } from "./repository-luna-model.ts";
import { prepareRepositoryComparisonPlan, runRepositoryComparison, RepositoryComparisonStop, type RepositoryComparisonPublicTask } from "./repository-comparison.ts";
import type { RepositoryCloudBroker } from "./repository-cloud-broker.ts";
import type { RepositoryJudgeConfiguration } from "./repository-official-judge.ts";

/** A host-runner integration, never a production route or standalone grant.
 * Boot must configure the fresh source-bound registration and durable runtime
 * authority. The owner supplies its exact approval digests to the kernel. */
export async function runRepositoryBenchmark(input: {
  kernel: SaraKernel; owner: Principal; registration: RepositoryBenchmarkRegistration;
  approval: { registrationDigest: string; authorityDigest: string };
  runId: string; tasks: RepositoryComparisonPublicTask[];
  apiKey: string;
  cloud?: { broker: RepositoryCloudBroker; judges: readonly RepositoryJudgeConfiguration[] };
}) {
  const registration = structuredClone(input.registration), tasks = structuredClone(input.tasks);
  const approval = structuredClone(input.approval);
  const { kernel, owner, runId, apiKey } = input;
  const cloud = input.cloud;
  const judges = structuredClone(cloud?.judges ?? []);
  if (sha256(canonicalJson(registration)) !== approval.registrationDigest) throw new Error("REPOSITORY_RUNNER_REGISTRATION_MISMATCH");
  const plan = prepareRepositoryComparisonPlan({ runId, tasks, limits: registration.producerLimits });
  const requested = plan.requests.map(r => canonicalJson({ task: r.task,
    environmentDigest: repositoryBinding(r.environment, r.task).environmentDigest })).sort();
  const registered = registration.attempts.map(a => canonicalJson({ task: a.task, environmentDigest: a.environmentDigest })).sort();
  if (canonicalJson(requested) !== canonicalJson(registered)) throw new Error("REPOSITORY_RUNNER_PLAN_MISMATCH");
  if (cloud && registration.attempts.some(a => !judges.some(j => j.environmentDigest === a.environmentDigest))) throw new Error("REPOSITORY_RUNNER_JUDGE_MISSING");
  return kernel.withRepositoryBenchmarkExecution(owner, approval, async execution => {
    const auditDirectory = execution.evidenceDirectory;
    let currentAuthority: (() => Promise<void>) | null = null;
    const jobs = new Map<string, { jobId: string; candidateDigest: string; patchDigest: string }>();
    const budget = createBenchmarkDispatchBudget({ directory: auditDirectory,
      beforeDispatch: async () => {
        if (!currentAuthority) throw new Error("REPOSITORY_DISPATCH_OUTSIDE_KERNEL_ATTEMPT");
        await currentAuthority();
      },
      model: registration.model.name, reasoning: registration.model.reasoning,
      arms: ["conventional", "reparodynamic"],
      attempts: registration.attempts.map(a => ({ id: a.attemptId, arm: a.task.arm })),
      maximumInputTokens: registration.model.maximumInputTokens,
      maximumOutputTokens: registration.model.maximumOutputTokens,
      inputPriceTenthsMicros: registration.model.inputPriceTenthsMicros,
      outputPriceTenthsMicros: registration.model.outputPriceTenthsMicros,
      totalCapMicros: registration.spend.totalMicros,
      armCapMicros: registration.spend.armMicros,
      attemptCapMicros: registration.spend.attemptMicros,
      maximumGenerationRequestsPerAttempt: registration.model.maximumRequestsPerAttempt,
    });
    try {
      await cloud?.broker.begin(auditDirectory);
      const comparison = await runRepositoryComparison({ runId, tasks, limits: registration.producerLimits,
        async runAttempt(request) {
          if (budget.snapshot().closed) throw new RepositoryComparisonStop("spend_uncertainty");
          const binding = repositoryBinding(request.environment, request.task);
          const registered = registration.attempts.find(a => a.environmentDigest === binding.environmentDigest
            && canonicalJson(a.task) === canonicalJson(request.task));
          if (!registered) throw new RepositoryComparisonStop("authority");
          const index = registration.attempts.indexOf(registered);
          const prefix = `attempt-${String(index).padStart(2, "0")}`;
          const job = await kernel.createSelfDevelopmentJob(SARA_PRINCIPAL, {
            objective: `Repository benchmark ${registered.attemptId}`, expectedOwnerValue: 1,
            requiredCapabilities: ["repository-benchmark"], acceptanceCriteria: ["Freeze a repository patch for independent grading"],
            // The job does not draw on Compound Reserve. The kernel's separate
            // explicit benchmark permit holds the real owner-grant exposure.
            maximumBudgetUsd: 0,
          });
          const permit = await execution.permitFor(job.id, registered.attemptId);
          let producer: RepositoryProducerResult | null = null;
          try {
            const receipt = await kernel.runRepositoryBuildCycle(SARA_PRINCIPAL, job.id, binding.environmentDigest,
              request.task, { id: "matched-repository-luna", external: true,
                maximumCostUsd: registration.spend.attemptMicros / 1e6,
                async generate(context) {
                  const beforeAction = async () => { await context.beforeAction(); await cloud?.broker.assertActive(); };
                  currentAuthority = beforeAction;
                  await currentAuthority();
                  await cloud?.broker.openAssignment({ phase: "producer", attemptId: registered.attemptId,
                    task: context.task, environment: context.environment });
                  const sandbox = await createRepositoryProducerSandbox(context.environment, cloud?.broker.startSession);
                  try {
                    producer = await runRepositoryProducer({ task: context.task, environment: context.environment,
                      limits: request.limits, beforeAction, sandbox,
                      model: createRepositoryLunaModel({ apiKey, budget, attemptId: registered.attemptId,
                        maximumOutputTokens: registration.model.maximumOutputTokens }) });
                    await writeBenchmarkAudit(auditDirectory, `${prefix}-producer.json`, producer);
                    return { environmentDigest: context.environmentDigest, taskDigest: context.taskDigest, patch: producer.patch };
                  } finally { await sandbox.close(); currentAuthority = null; }
                },
              }, permit);
            if (!producer) throw new Error("REPOSITORY_PRODUCER_MISSING");
            await writeBenchmarkAudit(auditDirectory, `${prefix}-kernel.json`, { jobId: job.id, receipt });
            jobs.set(binding.taskDigest, { jobId: job.id, candidateDigest: receipt.candidateDigest, patchDigest: receipt.patchDigest });
            await cloud?.broker.finishAssignment();
            return { producer, candidateDigest: receipt.candidateDigest };
          } catch (error) {
            currentAuthority = null;
            await writeBenchmarkAudit(auditDirectory, `${prefix}-failure.json`, { jobId: job.id,
              reason: error instanceof Error ? error.message.slice(0, 500) : "REPOSITORY_ATTEMPT_FAILED",
              producer, budget: budget.snapshot(), replayAllowed: false });
            if (budget.snapshot().closed) throw new RepositoryComparisonStop("spend_uncertainty");
            throw error;
          }
        },
        async freezeProducers(rows, digest) {
          await writeBenchmarkAudit(auditDirectory, "producer-freeze.json", { rows, digest });
          await cloud?.broker.producersFrozen();
        },
        async grade({ task, candidateDigest, patchDigest }) {
          const job = jobs.get(sha256(canonicalJson(task)));
          if (!job || job.candidateDigest !== candidateDigest || job.patchDigest !== patchDigest) throw new RepositoryComparisonStop("authority");
          if (cloud) {
            const attempt = registration.attempts.find(a => canonicalJson(a.task) === canonicalJson(task))!;
            const environment = tasks.find(t => t.instanceId === task.instanceId)!.environment;
            const judge = judges.find(j => j.environmentDigest === attempt.environmentDigest)!;
            await cloud.broker.openAssignment({ phase: "judge", attemptId: attempt.attemptId, task, environment,
              judge: { image: judge.image, ...(judge.fixtureProxyImage ? { fixtureProxyImage: judge.fixtureProxyImage } : {}) } });
          }
          try {
            const grade = await kernel.runRepositoryOfficialAcceptance(SARA_PRINCIPAL, job.jobId);
            if (!grade.result.gradeCompleted) throw new Error("OFFICIAL_GRADE_INCOMPLETE");
            return { resolved: grade.result.resolved, receiptDigest: grade.judgeReceiptDigest };
          } finally { await cloud?.broker.finishAssignment(); }
        },
      });
      await writeBenchmarkAudit(auditDirectory, "comparison-result.json", comparison);
      return comparison;
    } finally {
      currentAuthority = null;
      cloud?.broker.end();
      await writeBenchmarkAudit(auditDirectory, "budget-final.json", { ...budget.snapshot(), replayAllowed: false });
    }
  });
}
