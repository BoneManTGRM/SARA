from pathlib import Path
import re


def sub(path: str, pattern: str, replacement: str, *, flags=0, label: str):
    p = Path(path)
    text = p.read_text()
    updated, count = re.subn(pattern, replacement, text, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 replacement, got {count}")
    p.write_text(updated)


def replace(path: str, old: str, new: str, *, label: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 replacement, got {count}")
    p.write_text(text.replace(old, new))

# Kernel imports.
replace(
    "src/kernel.ts",
    'import { boundedCandidateFailureFeedback, isCandidateMetadataFailureFeedback } from "./cloudflare-free-generator.ts";\n',
    'import { boundedCandidateFailureFeedback } from "./cloudflare-free-generator.ts";\n'
    'import {\n'
    '  learningAttemptBudgeter,\n'
    '  learningFailureTriage,\n'
    '  qualificationReadinessCheck,\n'
    '  skillFailureMemorySelector,\n'
    '  targetedRepairPlanner,\n'
    '  previousCandidateSourceBytes,\n'
    '} from "./learning-acceleration.ts";\n',
    label="kernel acceleration import",
)

# Learning-specific bounded context, budgeting and targeted repair.
sub(
    "src/kernel.ts",
    r'''      const recalled = recallMemories\(state\.memories, \{.*?      const previousFailure = state\.memories\.find\(m => m\.id === `learning-failure-\$\{job\.learningParentJobId\}`\);\n      await this\.#store\.append\("job_status_changed", principal, \{\n        jobId,\n        from: job\.status,\n        status: "running",\n        generatorId: generator\.id,\n        maximumCostUsd: generator\.maximumCostUsd,\n        memoryContextDigest: memoryContext\.contextDigest,\n        memoryIds: memoryContext\.memories\.map\(\(memory\) => memory\.id\),\n      \}\);\n      return \{ \.\.\.compiled, memoryContext,\n        previousAttempt: previous && previousFailure \? \{\.\.\.previous, feedback:previousFailure\.statement\.slice\(0,1500\)\} : undefined,\n        learning: job\.workCard\.requiredCapabilities\.includes\("autonomous-learning"\),''',
    '''      const learning = job.workCard.requiredCapabilities.includes("autonomous-learning");
      const recalled = recallMemories(state.memories, {
        query: [job.workCard.objective, ...job.workCard.acceptanceCriteria, ...job.workCard.missingCapabilities].join(" "),
        scope: "global",
        categories: ["constitutional", "strategic", "economic", "procedural", "failure", "skill"],
        limit: 12,
      });
      const previous = job.learningParentJobId ? [...state.events].reverse().find(e => e.type === "learning_candidate_observed" &&
        (e.data as {jobId:string}).jobId === job.learningParentJobId)?.data as
        {proposal:import("./types.ts").SkillCandidateProposal;sourceDigest:string;proposedDigest:string} | undefined : undefined;
      const previousFailure = job.learningParentJobId
        ? state.memories.find(m => m.id === `learning-failure-${job.learningParentJobId}`)
        : undefined;
      const failureClass = previousFailure ? learningFailureTriage(previousFailure.statement).failureClass : undefined;
      const attemptBudget = learningAttemptBudgeter({
        objectiveLength: job.workCard.objective.length,
        publicCriteriaCount: job.workCard.acceptanceCriteria.length,
        publicBehavioralTestCount: job.workCard.acceptanceCriteria.length,
        priorFailureClass: failureClass,
        previousCandidateSourceBytes: previousCandidateSourceBytes(previous?.proposal),
        providerMaximumCompletionTokens: 4_096,
      });
      const selected = learning && job.learningCapabilityId && job.learningContractDigest
        ? skillFailureMemorySelector({
            memories: state.memories,
            capabilityId: job.learningCapabilityId,
            objective: job.workCard.objective,
            contractDigest: job.learningContractDigest,
            failureClass,
            maximumCount: attemptBudget.relevantMemoryMaximum,
            maximumCharacters: attemptBudget.relevantMemoryCharacterMaximum,
          })
        : [...recalled.anchors, ...recalled.relevant].slice(0, 12);
      const memoryContext = {
        contextDigest: sha256(canonicalJson({ memoryIds: selected.map(memory => memory.id) })),
        memories: selected,
      };
      let previousAttempt: typeof previous & {feedback:string} | undefined;
      if (learning && previous && previousFailure && job.learningContractDigest && failureClass) {
        const plan = targetedRepairPlanner({
          contractDigest: job.learningContractDigest,
          candidateDigest: previous.proposedDigest,
          publicCriteria: job.workCard.acceptanceCriteria,
          failureClass,
          measuredFeedback: boundedCandidateFailureFeedback(previousFailure.statement),
          measuredMemory: previousFailure.statement,
        });
        await this.#store.append("learning_targeted_repair_planned", principal, {
          jobId,
          parentJobId: job.learningParentJobId,
          sourceCandidateDigest: previous.proposedDigest,
          failureClass,
          outcome: plan.outcome,
          evidenceDigest: plan.evidenceDigest,
          directiveDigest: plan.directive ? sha256(plan.directive) : null,
        });
        if (plan.outcome === "TARGETED_REPAIR" && plan.directive) previousAttempt = { ...previous, feedback: plan.directive };
      }
      if (learning) {
        await this.#store.append("learning_attempt_budgeted", principal, {
          jobId,
          campaignId: job.learningCampaignId ?? null,
          capabilityId: job.learningCapabilityId ?? null,
          contractDigest: job.learningContractDigest ?? null,
          selectedMemoryIds: memoryContext.memories.map(memory => memory.id),
          relevantMemoryMaximum: attemptBudget.relevantMemoryMaximum,
          relevantMemoryCharacterMaximum: attemptBudget.relevantMemoryCharacterMaximum,
          behavioralTests: attemptBudget.behavioralTests,
          completionTokenBudget: attemptBudget.completionTokenBudget,
          attemptMode: attemptBudget.attemptMode,
        });
      }
      const learningBootEpoch = state.events.filter(event => event.type === "system_booted").at(-1)?.hash ?? null;
      await this.#store.append("job_status_changed", principal, {
        jobId,
        from: job.status,
        status: "running",
        generatorId: generator.id,
        maximumCostUsd: generator.maximumCostUsd,
        memoryContextDigest: memoryContext.contextDigest,
        memoryIds: memoryContext.memories.map((memory) => memory.id),
        ...(learning ? { learningBootEpoch } : {}),
      });
      return { ...compiled, memoryContext,
        previousAttempt,
        learning,''',
    flags=re.S,
    label="kernel bounded learning context",
)

# Classify provider failures separately from candidate failures and retain bounded evidence.
sub(
    "src/kernel.ts",
    r'''          await this\.#store\.append\("job_status_changed", principal, \{\n            jobId,\n            from: "running",\n            status: "failed",\n            generatorId: generator\.id,\n            reason: error instanceof Error \? error\.message\.slice\(0, 500\) : "Unknown candidate failure",\n          \}\);\n          await this\.authorize\(principal, \{ action: "record_memory", targetId: "global", external: false \}\);\n          const memory: MemoryRecord = \{\n            id: `learning-failure-\$\{jobId\}`, category: "failure", scope: "global",\n            source: `sara://learning-failure/\$\{sha256\(runningJob\.workCard\.objective\)\}/\$\{jobId\}`,\n            statement: `\$\{runningJob\.workCard\.objective\.slice\(0, 300\)\}: \$\{boundedCandidateFailureFeedback\(error\)\.slice\(0, 1_000\)\}`,\n            confidence: 1, verification: "measured", observedAt: new Date\(\)\.toISOString\(\),\n            lastValidatedAt: new Date\(\)\.toISOString\(\),\n            tags: \["learning-failure"\], status: "active",\n            dependencies: proposedDigest \? \[`candidate:\$\{proposedDigest\}`\] : \[\],\n          \};\n          await this\.#store\.append\("memory_recorded", principal, memory\);\n          if \(runningJob\.learningCampaignId\) \{\n            const feedbackDigest=sha256\(boundedCandidateFailureFeedback\(error\)\);\n            const prior=state\.events\.find\(e=>e\.type==="learning_attempt_failed" && \(e\.data as \{jobId:string\}\)\.jobId===runningJob\.learningParentJobId\);\n            await this\.#store\.append\("learning_attempt_failed",principal,\{jobId,feedbackDigest,\n              repeatedFeedback:Boolean\(prior && \(prior\.data as \{feedbackDigest:string\}\)\.feedbackDigest===feedbackDigest\),\n              candidateDigest:proposedDigest \?\? null\}\);\n          \}''',
    '''          const isLearning = runningJob.workCard.requiredCapabilities.includes("autonomous-learning");
          const triage = isLearning ? learningFailureTriage(error) : null;
          const safeFailure = isLearning
            ? `${triage!.failureClass}:${triage!.evidenceCode}`
            : error instanceof Error ? error.message.slice(0, 500) : "Unknown candidate failure";
          await this.#store.append("job_status_changed", principal, {
            jobId,
            from: "running",
            status: "failed",
            generatorId: generator.id,
            reason: safeFailure,
          });
          await this.authorize(principal, { action: "record_memory", targetId: "global", external: false });
          const providerFailure = Boolean(triage && ["provider_transient", "provider_terminal"].includes(triage.failureClass));
          const failureText = providerFailure
            ? `${runningJob.workCard.objective.slice(0, 300)}: Learning provider execution failed (${triage!.evidenceCode}); candidate quality was not evaluated by this failure.`
            : `${runningJob.workCard.objective.slice(0, 300)}: ${boundedCandidateFailureFeedback(error).slice(0, 1_000)}`;
          const memory: MemoryRecord = {
            id: providerFailure ? `learning-provider-failure-${jobId}` : `learning-failure-${jobId}`,
            category: "failure", scope: "global",
            source: providerFailure
              ? `sara://learning-provider-failure/${sha256(runningJob.workCard.objective)}/${jobId}`
              : `sara://learning-failure/${sha256(runningJob.workCard.objective)}/${jobId}`,
            statement: failureText,
            confidence: 1, verification: "measured", observedAt: new Date().toISOString(),
            lastValidatedAt: new Date().toISOString(),
            tags: [providerFailure ? "learning-provider-failure" : "learning-failure", ...(triage ? [`failure-class:${triage.failureClass}`] : [])], status: "active",
            dependencies: !providerFailure && proposedDigest ? [`candidate:${proposedDigest}`] : [],
          };
          await this.#store.append("memory_recorded", principal, memory);
          if (runningJob.learningCampaignId && triage) {
            const feedbackDigest = sha256(providerFailure ? triage.evidenceCode : boundedCandidateFailureFeedback(error));
            const prior = state.events.find(e => e.type === "learning_attempt_failed" && (e.data as {jobId:string}).jobId === runningJob.learningParentJobId);
            await this.#store.append("learning_attempt_failed", principal, {
              jobId,
              feedbackDigest,
              repeatedFeedback: Boolean(prior && (prior.data as {feedbackDigest:string}).feedbackDigest === feedbackDigest),
              candidateDigest: proposedDigest ?? null,
              failureClass: triage.failureClass,
              nextAction: triage.nextAction,
              evidenceCode: triage.evidenceCode,
            });
          }''',
    flags=re.S,
    label="kernel failure triage",
)

# Qualification readiness preflight before independent execution.
replace(
    "src/kernel.ts",
    '''    let receipt: Awaited<ReturnType<typeof qualifyLearningArtifact>> | undefined;
    try {
      receipt = await qualifyLearningArtifact({ artifactDirectory: join(this.#store.stateDirectory, prepared.mutation.artifactRelativePath!),
        candidateDigest: prepared.mutation.candidateDigest, contractDigest: prepared.contractDigest, tests: prepared.contract.acceptanceTests });
    } catch { /* Keep hidden acceptance answers and arbitrary child errors private. */ }
''',
    '''    let artifactIntegrityValid = false;
    try {
      await verifyGenomeLabArtifact(this.#store.stateDirectory, prepared.mutation.artifactRelativePath!, prepared.mutation.candidateDigest);
      artifactIntegrityValid = true;
    } catch { /* Readiness records only the failed prerequisite, never arbitrary verifier output. */ }
    const producerBehavioralVerificationPassed = prepared.mutation.evidence.some(evidence =>
      evidence.exitCode === 0 && evidence.candidateDigest === prepared.mutation.candidateDigest &&
      evidence.command === "kernel:isolated-typescript-behavioral-verification");
    const readiness = qualificationReadinessCheck({
      candidateExists: true,
      candidateDigest: prepared.mutation.candidateDigest,
      artifactIntegrityValid,
      sourcePolicyPassed: producerBehavioralVerificationPassed,
      typeScriptVerificationPassed: producerBehavioralVerificationPassed,
      producerBehavioralVerificationPassed,
      contractId: prepared.contract.capabilityId,
      contractDigest: prepared.contractDigest,
      qualificationEnvironmentDigest: prepared.environmentDigest,
      publicContractPresent: Boolean(prepared.contract.objective.trim() && prepared.contract.publicCriteria.length),
    });
    await this.serializeMutation(async () => {
      const current = await this.state();
      const alreadyRecorded = current.events.some(event => event.type === "learning_qualification_readiness_checked" &&
        (event.data as {jobId:string;candidateDigest:string;environmentDigest:string}).jobId === jobId &&
        (event.data as {candidateDigest:string}).candidateDigest === prepared.mutation.candidateDigest &&
        (event.data as {environmentDigest:string}).environmentDigest === prepared.environmentDigest);
      if (!alreadyRecorded) await this.#store.append("learning_qualification_readiness_checked", SARA_PRINCIPAL, {
        jobId,
        mutationId: prepared.mutation.id,
        candidateDigest: prepared.mutation.candidateDigest,
        contractDigest: prepared.contractDigest,
        environmentDigest: prepared.environmentDigest,
        status: readiness.status,
        prerequisiteFailures: readiness.prerequisiteFailures,
      });
    });
    if (readiness.status === "NOT_READY") return { status: "not_ready" as const, prerequisiteFailures: readiness.prerequisiteFailures };
    let receipt: Awaited<ReturnType<typeof qualifyLearningArtifact>> | undefined;
    try {
      receipt = await qualifyLearningArtifact({ artifactDirectory: join(this.#store.stateDirectory, prepared.mutation.artifactRelativePath!),
        candidateDigest: prepared.mutation.candidateDigest, contractDigest: prepared.contractDigest, tests: prepared.contract.acceptanceTests });
    } catch { /* Keep hidden acceptance answers and arbitrary child errors private. */ }
''',
    label="qualification readiness",
)

# Worker order: unfinished work before qualification/new gap.
replace(
    "src/kernel.ts",
    '''    const environmentDigest = await qualificationEnvironmentDigest();
    const pending = state.jobs.find(job => {
''',
    '''    const unfinished = state.jobs.some(job => job.kind === "self_development" && job.learningCampaignId === campaign.id &&
      ["authorized", "running"].includes(job.status));
    if (unfinished) {
      const resumed = await this.runNextAutonomousLearningCycle(generator);
      if (resumed.status === "verified_shadow" && resumed.jobId) return this.qualifyLearningJob(resumed.jobId);
      return resumed;
    }
    const environmentDigest = await qualificationEnvironmentDigest();
    const pending = state.jobs.find(job => {
''',
    label="worker recovery order",
)

# Replace autonomous learning reservation/dispatch with idempotent recovery and one bounded provider retry.
sub(
    "src/kernel.ts",
    r'''  /\*\* Consume one delegated backlog entry; reservations survive failure/restart\. \*/\n  async runNextAutonomousLearningCycle\(generator: CandidateGenerator\): Promise<\{\n    status: "idle" \| "blocked" \| "failed" \| "verified_shadow"; jobId\?: string;\n  \}> \{.*?\n  \}\n\n  private queueLearningFollowup''',
    '''  /** Consume or recover one delegated backlog entry; reservations survive failure/restart. */
  async runNextAutonomousLearningCycle(generator: CandidateGenerator): Promise<{
    status: "idle" | "blocked" | "failed" | "verified_shadow"; jobId?: string;
  }> {
    if (generator.maximumCostUsd !== 0) throw new Error("Autonomous learning requires a zero-cost generator.");
    const reservation = await this.serializeMutation(async () => {
      const state = await this.state();
      if (state.emergencyStopped) return null;
      const now = new Date().toISOString();
      const reservations = state.events.filter(event => event.type === "autonomous_learning_reserved");
      const campaign = currentLearningCampaign(state.events);
      const currentBootEpoch = state.events.filter(event => event.type === "system_booted").at(-1)?.hash ?? null;
      const reservedIds = new Set(reservations.map(event => (event.data as {jobId:string}).jobId));
      let job = state.jobs.filter(candidate => candidate.kind === "self_development" &&
        ["authorized", "running"].includes(candidate.status) &&
        (campaign ? candidate.learningCampaignId === campaign.id : !candidate.learningCampaignId) &&
        candidate.workCard.maximumBudgetUsd === 0 && candidate.workCard.requiredCapabilities.includes("autonomous-learning"))
        .sort((a,b) => Number(b.status === "running") - Number(a.status === "running") ||
          Number(Boolean(b.learningParentJobId)) - Number(Boolean(a.learningParentJobId)) ||
          b.workCard.expectedOwnerValue - a.workCard.expectedOwnerValue || a.id.localeCompare(b.id))[0];
      if (!job) return undefined;

      const latestRunningEvent = [...state.events].reverse().find(event => event.type === "job_status_changed" &&
        (event.data as {jobId?:string;status?:string}).jobId === job!.id && (event.data as {status?:string}).status === "running");
      if (job.status === "running") {
        const runningData = latestRunningEvent?.data as {learningBootEpoch?:string|null} | undefined;
        const sameBoot = Boolean(runningData?.learningBootEpoch && runningData.learningBootEpoch === currentBootEpoch);
        const runningAt = latestRunningEvent ? Date.parse(latestRunningEvent.occurredAt) : Number.NaN;
        const recentLease = Number.isFinite(runningAt) && Date.now() - runningAt < 15 * 60_000;
        if (sameBoot || recentLease) {
          const reason = sameBoot ? "LEARNING_ATTEMPT_ACTIVE_IN_CURRENT_BOOT" : "LEARNING_RECOVERY_LEASE_ACTIVE";
          const alreadyDeferred = state.events.some(event => event.type === "learning_recovery_deferred" &&
            (event.data as {jobId?:string;bootEpoch?:string|null;reason?:string}).jobId === job!.id &&
            (event.data as {bootEpoch?:string|null}).bootEpoch === currentBootEpoch &&
            (event.data as {reason?:string}).reason === reason);
          if (!alreadyDeferred) await this.#store.append("learning_recovery_deferred", SARA_PRINCIPAL, {
            jobId: job.id, campaignId: job.learningCampaignId ?? null, contractDigest: job.learningContractDigest ?? null,
            bootEpoch: currentBootEpoch, reason, leaseMinutes: recentLease ? 15 : 0,
          });
          return null;
        }
        await this.#store.append("job_status_changed", SARA_PRINCIPAL, {
          jobId: job.id, from: "running", status: "authorized", reason: "LEARNING_PROCESS_RESTART_RECOVERY",
          recoveryBootEpoch: currentBootEpoch,
        });
        await this.#store.append("learning_job_recovered", SARA_PRINCIPAL, {
          jobId: job.id, campaignId: job.learningCampaignId ?? null, capabilityId: job.learningCapabilityId ?? null,
          contractDigest: job.learningContractDigest ?? null, sourceJobId: job.learningSourceJobId ?? null,
          parentJobId: job.learningParentJobId ?? null, rootJobId: job.learningRootJobId ?? job.id,
          recoveryKind: "stale_running",
        });
        job = { ...job, status: "authorized" };
      }

      const existingReservation = [...reservations].reverse().find(event => (event.data as {jobId:string}).jobId === job!.id);
      const request: RoutineActionRequest = {id:`learning:${job.id}`,kind:"business_candidate_development",targetId:job.id,
        channel:"internal",serviceId:"skill-learning",estimatedCostUsd:0,external:generator.external,requestedAt:now,platform:"owner_site"};
      if (existingReservation) {
        const data = existingReservation.data as {jobId:string;mandateDigest:string;campaignId?:string;contractDigest?:string};
        const invalid = !state.standingMandate || state.standingMandate.digest !== data.mandateDigest ||
          (campaign ? data.campaignId !== campaign.id || job.learningCampaignId !== campaign.id || data.contractDigest !== job.learningContractDigest : Boolean(data.campaignId));
        const decision = evaluateRoutineAction({mandate:state.standingMandate,request,emergencyStopped:state.emergencyStopped});
        if (invalid || decision.outcome !== "automatic") {
          await this.#store.append("job_status_changed", SARA_PRINCIPAL, {jobId:job.id,from:"authorized",status:"failed",reason:"LEARNING_RECOVERY_AUTHORITY_OR_IDENTITY_INVALID"});
          await this.#store.append("learning_recovery_terminal", SARA_PRINCIPAL, {
            jobId:job.id,campaignId:job.learningCampaignId ?? null,contractDigest:job.learningContractDigest ?? null,
            sourceJobId:job.learningSourceJobId ?? null,parentJobId:job.learningParentJobId ?? null,rootJobId:job.learningRootJobId ?? job.id,
            reason:"LEARNING_RECOVERY_AUTHORITY_OR_IDENTITY_INVALID",
          });
          return null;
        }
        const retriesUsed = state.events.filter(event => event.type === "learning_provider_retry_started" &&
          (event.data as {jobId:string}).jobId === job!.id).length;
        await this.#store.append("learning_dispatch_claimed", SARA_PRINCIPAL, {
          jobId:job.id,campaignId:job.learningCampaignId ?? null,contractDigest:job.learningContractDigest ?? null,
          bootEpoch:currentBootEpoch,reservationEventHash:existingReservation.hash,recovered:true,
        });
        return {jobId:job.id,mandateDigest:data.mandateDigest,request,
          mandateEpoch:state.events.filter(e=>e.type==="standing_mandate_snapshot").at(-1)?.hash ?? null,
          stopEpoch:state.events.filter(e=>e.type==="emergency_stop_changed").at(-1)?.hash ?? null,
          transportRetriesUsed:retriesUsed};
      }

      if (campaign && campaignAccounting(campaign, state.events).remaining === 0) {
        await this.#store.append("job_status_changed", SARA_PRINCIPAL, {jobId:job.id,from:"authorized",status:"failed",reason:"LEARNING_CAMPAIGN_REQUESTS_EXHAUSTED"});
        await this.#store.append("learning_recovery_terminal", SARA_PRINCIPAL, {
          jobId:job.id,campaignId:job.learningCampaignId ?? null,contractDigest:job.learningContractDigest ?? null,
          sourceJobId:job.learningSourceJobId ?? null,parentJobId:job.learningParentJobId ?? null,rootJobId:job.learningRootJobId ?? job.id,
          reason:"LEARNING_CAMPAIGN_REQUESTS_EXHAUSTED",
        });
        return null;
      }
      if (reservations.filter(event => event.occurredAt.slice(0,10) === now.slice(0,10)).length >= 2) {
        const alreadyDeferred = state.events.some(event => event.type === "learning_recovery_deferred" &&
          (event.data as {jobId?:string;date?:string;reason?:string}).jobId === job!.id &&
          (event.data as {date?:string}).date === now.slice(0,10) &&
          (event.data as {reason?:string}).reason === "LEARNING_DAILY_RESERVATION_LIMIT");
        if (!alreadyDeferred) await this.#store.append("learning_recovery_deferred", SARA_PRINCIPAL, {
          jobId:job.id,campaignId:job.learningCampaignId ?? null,contractDigest:job.learningContractDigest ?? null,
          date:now.slice(0,10),reason:"LEARNING_DAILY_RESERVATION_LIMIT",
        });
        return null;
      }
      if (reservedIds.has(job.id)) throw new Error("LEARNING_RESERVATION_IDENTITY_CORRUPT");
      if (evaluateRoutineAction({mandate:state.standingMandate,request,emergencyStopped:state.emergencyStopped}).outcome !== "automatic") return null;
      const decision = await this.authorizeAutonomousRoutine(SARA_PRINCIPAL,state,request,false);
      if (decision.outcome !== "automatic") return null;
      await this.#store.append("autonomous_learning_reserved",SARA_PRINCIPAL,{jobId:job.id,mandateDigest:state.standingMandate!.digest,...(campaign ? {campaignId:campaign.id,contractDigest:job.learningContractDigest} : {})});
      const latest = await this.state();
      const reservationEvent = [...latest.events].reverse().find(event => event.type === "autonomous_learning_reserved" && (event.data as {jobId:string}).jobId === job!.id)!;
      await this.#store.append("learning_dispatch_claimed", SARA_PRINCIPAL, {
        jobId:job.id,campaignId:job.learningCampaignId ?? null,contractDigest:job.learningContractDigest ?? null,
        bootEpoch:currentBootEpoch,reservationEventHash:reservationEvent.hash,recovered:false,
      });
      return {jobId:job.id,mandateDigest:state.standingMandate!.digest,request,
        mandateEpoch:state.events.filter(e=>e.type==="standing_mandate_snapshot").at(-1)?.hash ?? null,
        stopEpoch:state.events.filter(e=>e.type==="emergency_stop_changed").at(-1)?.hash ?? null,
        transportRetriesUsed:0};
    });
    if (!reservation) return {status:reservation === undefined ? "idle" : "blocked"};
    let transportRetriesUsed = reservation.transportRetriesUsed;
    try {
      const result = await this.runSelfBuildCycle(SARA_PRINCIPAL,reservation.jobId,{
        id:generator.id,external:generator.external,maximumCostUsd:0,
        generate:async input => {
          const checkMandate = () => this.serializeMutation(async () => {
            const state = await this.state();
            const decision = evaluateRoutineAction({mandate:state.standingMandate,request:{...reservation.request,requestedAt:new Date().toISOString()},emergencyStopped:state.emergencyStopped});
            if (decision.outcome !== "automatic" || state.standingMandate?.digest !== reservation.mandateDigest ||
                (state.events.filter(e=>e.type==="standing_mandate_snapshot").at(-1)?.hash ?? null) !== reservation.mandateEpoch ||
                (state.events.filter(e=>e.type==="emergency_stop_changed").at(-1)?.hash ?? null) !== reservation.stopEpoch) throw new Error("Learning mandate changed before dispatch.");
          });
          await checkMandate();
          try {
            const proposal = await generator.generate(input);
            await checkMandate();
            return proposal;
          } catch (firstError) {
            const firstTriage = learningFailureTriage(firstError);
            if (firstTriage.failureClass !== "provider_transient" || firstTriage.nextAction !== "retry_same_reservation" || transportRetriesUsed >= 1) throw firstError;
            await this.serializeMutation(async () => {
              const current = await this.state();
              const retryAlreadyStarted = current.events.some(event => event.type === "learning_provider_retry_started" &&
                (event.data as {jobId:string}).jobId === reservation.jobId);
              if (retryAlreadyStarted) throw new Error("LEARNING_PROVIDER_RETRY_ALREADY_CONSUMED");
              const job = current.jobs.find(candidate => candidate.id === reservation.jobId);
              const reserved = current.events.some(event => event.type === "autonomous_learning_reserved" &&
                (event.data as {jobId:string;campaignId?:string;contractDigest?:string}).jobId === reservation.jobId &&
                (!job?.learningCampaignId || ((event.data as {campaignId?:string}).campaignId === job.learningCampaignId &&
                  (event.data as {contractDigest?:string}).contractDigest === job.learningContractDigest)));
              if (!reserved || current.standingMandate?.digest !== reservation.mandateDigest) throw new Error("LEARNING_PROVIDER_RETRY_IDENTITY_CHANGED");
              await this.#store.append("learning_provider_retry_started", SARA_PRINCIPAL, {
                jobId:reservation.jobId,campaignId:job?.learningCampaignId ?? null,contractDigest:job?.learningContractDigest ?? null,
                attempt:1,failureClass:firstTriage.failureClass,evidenceCode:firstTriage.evidenceCode,sameReservation:true,
              });
            });
            transportRetriesUsed += 1;
            await checkMandate();
            try {
              const proposal = await generator.generate(input);
              await checkMandate();
              await this.serializeMutation(() => this.#store.append("learning_provider_retry_finished", SARA_PRINCIPAL, {
                jobId:reservation.jobId,attempt:1,status:"succeeded",sameReservation:true,
              }));
              return proposal;
            } catch (secondError) {
              const secondTriage = learningFailureTriage(secondError);
              await this.serializeMutation(() => this.#store.append("learning_provider_retry_finished", SARA_PRINCIPAL, {
                jobId:reservation.jobId,attempt:1,status:"failed",failureClass:secondTriage.failureClass,evidenceCode:secondTriage.evidenceCode,sameReservation:true,
              }));
              throw secondError;
            }
          }
        },
      });
      return {status:result.job.status === "verified" && result.mutation.stage === "SHADOW" ? "verified_shadow" : "failed",jobId:reservation.jobId};
    } catch (error) {
      await this.queueLearningFollowup(reservation.jobId, reservation.mandateDigest, error);
      return {status:"failed",jobId:reservation.jobId};
    }
  }

  private queueLearningFollowup''',
    flags=re.S,
    label="learning recovery and provider retry",
)

# Only candidate failures can produce targeted-repair children.
replace(
    "src/kernel.ts",
    '''      const feedback = boundedCandidateFailureFeedback(error);
      if (!independentFailure && !isCandidateMetadataFailureFeedback(feedback) && !/^(?:Generated skill is not a pure isolated candidate:|Generated skill contains invalid TypeScript syntax\\.|Generated skill failed TypeScript verification with |Behavioral verification mismatches:)/u.test(feedback)) return;
      const failure = state.memories.find(memory => memory.id === `learning-failure-${jobId}`);
''',
    '''      const failure = state.memories.find(memory => memory.id === `learning-failure-${jobId}`);
      const triage = learningFailureTriage(independentFailure ? independentFailure ? new Error("Independent acceptance failed; hidden answers withheld.") : error : error);
      if (!independentFailure && triage.nextAction !== "targeted_repair") return;
''',
    label="followup failure triage",
)

# Targeted planner directives have an explicit trusted internal prefix.
replace(
    "src/learning-acceleration.ts",
    '    directive: `${rule.directive} Frozen contract ${input.contractDigest}; rejected candidate ${input.candidateDigest}.`,\n',
    '    directive: `TARGETED_REPAIR: ${rule.directive} Frozen contract ${input.contractDigest}; rejected candidate ${input.candidateDigest}.`,\n',
    label="targeted repair prefix",
)

# Cloudflare generator: bounded memory, bounded repair context, and evidence-based token envelope.
replace(
    "src/cloudflare-free-generator.ts",
    'import { GenomeLabTypecheckError } from "./genome-lab.ts";\n',
    'import { GenomeLabTypecheckError } from "./genome-lab.ts";\n'
    'import { learningAttemptBudgeter, learningFailureTriage, previousCandidateSourceBytes } from "./learning-acceleration.ts";\n',
    label="generator acceleration import",
)
replace(
    "src/cloudflare-free-generator.ts",
    '''  const prompt = [
''',
    '''  const previousFailureClass = input.previousAttempt
    ? (() => { const observed = learningFailureTriage(input.previousAttempt!.feedback).failureClass; return observed === "unknown" ? "behavioral_failure" as const : observed; })()
    : undefined;
  const budget = learningAttemptBudgeter({
    objectiveLength: input.objective.length,
    publicCriteriaCount: input.acceptanceCriteria.length,
    publicBehavioralTestCount: input.acceptanceCriteria.length,
    priorFailureClass: previousFailureClass,
    previousCandidateSourceBytes: previousCandidateSourceBytes(input.previousAttempt?.proposal),
    providerMaximumCompletionTokens: 4_096,
  });
  const prompt = [
''',
    label="generator prompt budget",
)
replace(
    "src/cloudflare-free-generator.ts",
    '    "Include 2–8 behavioral tests. Keep all output below 64 KiB. Do not use Markdown fences or commentary.",\n',
    '    `Include ${budget.behavioralTests.minimum}–${budget.behavioralTests.maximum} behavioral tests. Keep the JSON concise and complete. Do not use Markdown fences or commentary.`,\n',
    label="generator bounded tests",
)
replace(
    "src/cloudflare-free-generator.ts",
    '  ).slice(-4).map(memory => ({ id: memory.id, evidence: memory.statement.slice(0, 1_500) }));\n',
    '  ).slice(-budget.relevantMemoryMaximum).map(memory => ({ id: memory.id, evidence: memory.statement.slice(0, Math.min(1_200, budget.relevantMemoryCharacterMaximum)) }));\n',
    label="generator bounded memories",
)
sub(
    "src/cloudflare-free-generator.ts",
    r'''  if \(repairProposal\) \{\n    prompt\.push\(\n      "",\n      "The previous proposal was rejected\. Do not assume source, TypeScript, or behavioral checks passed; use the recorded verifier evidence below\.",\n      "Repair the source and/or exact expected values, return the complete replacement proposal, and do not omit any required field\.",\n      "A compiler fix alone does not satisfy the objective\. Validate every stated input restriction at runtime; type assertions are not runtime validation\. Recheck every stated output rule and cover the relevant public boundary cases in your tests\. For a source/compiler failure, change the source to address the evidence; returning the same source is not a repair\. Do not change correct expected results merely to match broken code\.",\n    \);\n    const feedback = `Bounded independent verifier feedback: \$\{repairFeedback \|\| "Candidate was rejected; detailed verifier evidence is unavailable\."\}`;\n    const candidate = `Previous rejected proposal: \$\{JSON\.stringify\(repairProposal\)\}`;\n    prompt\.push\(\.\.\.\(repairArrangement === "candidate-first" \? \[candidate, feedback\] : \[feedback, candidate\]\)\);\n  \}''',
    '''  if (repairProposal) {
    prompt.push(
      "",
      "The previous proposal was rejected. Apply only the bounded measured repair directive; all source, TypeScript, behavioral, and independent qualification gates remain unchanged.",
      "Return the complete replacement JSON object. Do not change correct expected values merely to match broken code.",
    );
    const safeDirective = repairFeedback?.startsWith("TARGETED_REPAIR:")
      ? repairFeedback.slice(0, 1_500)
      : boundedCandidateFailureFeedback(new Error(repairFeedback || "Candidate verification failed; no earlier gate is asserted to have passed.")).slice(0, 1_500);
    const repairContext = {
      skillName: repairProposal.skillName,
      summary: repairProposal.summary.slice(0, 300),
      source: repairProposal.source,
      tests: repairProposal.tests.slice(0, budget.behavioralTests.maximum),
      limitations: repairProposal.limitations.slice(0, 8),
    };
    const feedback = `Measured repair directive: ${safeDirective}`;
    const candidate = `Previous rejected candidate (bounded repair context): ${JSON.stringify(repairContext)}`;
    prompt.push(...(repairArrangement === "candidate-first" ? [candidate, feedback] : [feedback, candidate]));
  }''',
    flags=re.S,
    label="generator targeted repair context",
)
replace(
    "src/cloudflare-free-generator.ts",
    '''    async generate(input) {
      const response = await fetcher(endpoint, {
''',
    '''    async generate(input) {
      const observedFailureClass = input.previousAttempt
        ? (() => { const observed = learningFailureTriage(input.previousAttempt!.feedback).failureClass; return observed === "unknown" ? "behavioral_failure" as const : observed; })()
        : undefined;
      const generationBudget = learningAttemptBudgeter({
        objectiveLength: input.objective.length,
        publicCriteriaCount: input.acceptanceCriteria.length,
        publicBehavioralTestCount: input.acceptanceCriteria.length,
        priorFailureClass: observedFailureClass,
        previousCandidateSourceBytes: previousCandidateSourceBytes(input.previousAttempt?.proposal),
        providerMaximumCompletionTokens: 4_096,
      });
      const response = await fetcher(endpoint, {
''',
    label="generator request budget",
)
replace(
    "src/cloudflare-free-generator.ts",
    '          max_completion_tokens: 8_192,\n',
    '          max_completion_tokens: generationBudget.completionTokenBudget,\n',
    label="generator completion budget",
)

# Existing prompt test now follows the bounded selector for small contracts.
replace(
    "tests/autonomous-learning.test.ts",
    '    assert.equal((prompt.match(/"evidence":/g) ?? []).length, 4);\n',
    '    assert.equal((prompt.match(/"evidence":/g) ?? []).length, 2);\n',
    label="bounded prompt memory expectation",
)

print("scoped learning acceleration integration applied")
