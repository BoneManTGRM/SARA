from pathlib import Path
import re

p=Path('src/kernel.ts'); text=p.read_text()
old='''        : [...recalled.anchors, ...recalled.relevant].slice(0, 12);'''
new='''        : learning
          ? [...recalled.anchors, ...recalled.relevant].slice(0, attemptBudget.relevantMemoryMaximum).map(memory => ({
              ...memory, statement: memory.statement.slice(0, Math.min(1_200, attemptBudget.relevantMemoryCharacterMaximum)),
            }))
          : [...recalled.anchors, ...recalled.relevant].slice(0, 12);'''
assert text.count(old)==1
text=text.replace(old,new)

# Cross-process restart recovery: same boot blocks; different boot reclaims, while provider lifecycle below decides if replay is safe.
old='''        const runningAt = latestRunningEvent ? Date.parse(latestRunningEvent.occurredAt) : Number.NaN;
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
        }'''
new='''        if (sameBoot) {
          const reason = "LEARNING_ATTEMPT_ACTIVE_IN_CURRENT_BOOT";
          const alreadyDeferred = state.events.some(event => event.type === "learning_recovery_deferred" &&
            (event.data as {jobId?:string;bootEpoch?:string|null;reason?:string}).jobId === job!.id &&
            (event.data as {bootEpoch?:string|null}).bootEpoch === currentBootEpoch &&
            (event.data as {reason?:string}).reason === reason);
          if (!alreadyDeferred) await this.#store.append("learning_recovery_deferred", SARA_PRINCIPAL, {
            jobId: job.id, campaignId: job.learningCampaignId ?? null, contractDigest: job.learningContractDigest ?? null,
            bootEpoch: currentBootEpoch, reason,
          });
          return null;
        }'''
assert text.count(old)==1
text=text.replace(old,new)

# Existing reservation recovery: prevent duplicate same-boot dispatch and decide replay from durable provider-call evidence.
needle='''        const retriesUsed = state.events.filter(event => event.type === "learning_provider_retry_started" &&
          (event.data as {jobId:string}).jobId === job!.id).length;
        await this.#store.append("learning_dispatch_claimed", SARA_PRINCIPAL, {
          jobId:job.id,campaignId:job.learningCampaignId ?? null,contractDigest:job.learningContractDigest ?? null,
          bootEpoch:currentBootEpoch,reservationEventHash:existingReservation.hash,recovered:true,
        });
        return {jobId:job.id,mandateDigest:data.mandateDigest,request,
          mandateEpoch:state.events.filter(e=>e.type==="standing_mandate_snapshot").at(-1)?.hash ?? null,
          stopEpoch:state.events.filter(e=>e.type==="emergency_stop_changed").at(-1)?.hash ?? null,
          transportRetriesUsed:retriesUsed};'''
replacement='''        const sameBootClaim = state.events.some(event => event.type === "learning_dispatch_claimed" &&
          (event.data as {jobId?:string;bootEpoch?:string|null}).jobId === job!.id &&
          (event.data as {bootEpoch?:string|null}).bootEpoch === currentBootEpoch);
        if (sameBootClaim) return null;
        const callStarts = state.events.filter(event => event.type === "learning_provider_call_started" &&
          (event.data as {jobId?:string}).jobId === job!.id);
        const callFinishes = state.events.filter(event => event.type === "learning_provider_call_finished" &&
          (event.data as {jobId?:string}).jobId === job!.id);
        const unfinishedCall = callStarts.find(start => !callFinishes.some(finish =>
          (finish.data as {attempt?:number}).attempt === (start.data as {attempt?:number}).attempt));
        const successfulCall = callFinishes.find(event => (event.data as {status?:string}).status === "succeeded");
        const secondFailure = callFinishes.find(event => (event.data as {attempt?:number;status?:string}).attempt === 1 &&
          (event.data as {status?:string}).status === "failed");
        const firstFailure = callFinishes.find(event => (event.data as {attempt?:number;status?:string}).attempt === 0 &&
          (event.data as {status?:string}).status === "failed");
        const legacyRunningWithoutLifecycle = latestRunningEvent && !(latestRunningEvent.data as {learningBootEpoch?:string|null}).learningBootEpoch && callStarts.length === 0;
        let terminalReason: string | null = null;
        if (unfinishedCall) terminalReason = "LEARNING_PROVIDER_CALL_OUTCOME_UNCERTAIN_AFTER_RESTART";
        else if (successfulCall) terminalReason = "LEARNING_PROVIDER_RESULT_NOT_DURABLE_AFTER_RESTART";
        else if (secondFailure) terminalReason = "LEARNING_PROVIDER_RETRY_ALREADY_FAILED";
        else if (legacyRunningWithoutLifecycle) terminalReason = "LEARNING_LEGACY_RUNNING_OUTCOME_UNCERTAIN_AFTER_RESTART";
        else if (firstFailure && (firstFailure.data as {failureClass?:string}).failureClass !== "provider_transient") terminalReason = "LEARNING_PROVIDER_FAILURE_NOT_RETRYABLE";
        if (terminalReason) {
          await this.#store.append("job_status_changed", SARA_PRINCIPAL, {jobId:job.id,from:"authorized",status:"failed",reason:terminalReason});
          await this.#store.append("learning_recovery_terminal", SARA_PRINCIPAL, {
            jobId:job.id,campaignId:job.learningCampaignId ?? null,contractDigest:job.learningContractDigest ?? null,
            sourceJobId:job.learningSourceJobId ?? null,parentJobId:job.learningParentJobId ?? null,rootJobId:job.learningRootJobId ?? job.id,
            reason:terminalReason,
          });
          return null;
        }
        const nextProviderAttempt = firstFailure ? 1 as const : 0 as const;
        if (nextProviderAttempt === 1 && !state.events.some(event => event.type === "learning_provider_retry_started" &&
          (event.data as {jobId?:string}).jobId === job!.id)) {
          await this.#store.append("learning_provider_retry_started", SARA_PRINCIPAL, {
            jobId:job.id,campaignId:job.learningCampaignId ?? null,contractDigest:job.learningContractDigest ?? null,
            attempt:1,failureClass:"provider_transient",evidenceCode:(firstFailure!.data as {evidenceCode?:string}).evidenceCode ?? "provider_transient:retained",sameReservation:true,
          });
        }
        await this.#store.append("learning_dispatch_claimed", SARA_PRINCIPAL, {
          jobId:job.id,campaignId:job.learningCampaignId ?? null,contractDigest:job.learningContractDigest ?? null,
          bootEpoch:currentBootEpoch,reservationEventHash:existingReservation.hash,recovered:true,
        });
        return {jobId:job.id,mandateDigest:data.mandateDigest,request,
          mandateEpoch:state.events.filter(e=>e.type==="standing_mandate_snapshot").at(-1)?.hash ?? null,
          stopEpoch:state.events.filter(e=>e.type==="emergency_stop_changed").at(-1)?.hash ?? null,
          nextProviderAttempt};'''
assert text.count(needle)==1
text=text.replace(needle,replacement)

text=text.replace('''        transportRetriesUsed:0};''','''        nextProviderAttempt:0 as const};''',1)

# Replace provider wrapper with durable start/finish boundaries and one bounded retry.
pattern=r'''        generate:async input => \{\n          const checkMandate = \(\) => this\.serializeMutation\(async \(\) => \{.*?\n          \}\n        \},\n      \}\);'''
m=re.search(pattern,text,re.S); assert m
block='''        generate:async input => {
          const checkMandate = () => this.serializeMutation(async () => {
            const state = await this.state();
            const decision = evaluateRoutineAction({mandate:state.standingMandate,request:{...reservation.request,requestedAt:new Date().toISOString()},emergencyStopped:state.emergencyStopped});
            if (decision.outcome !== "automatic" || state.standingMandate?.digest !== reservation.mandateDigest ||
                (state.events.filter(e=>e.type==="standing_mandate_snapshot").at(-1)?.hash ?? null) !== reservation.mandateEpoch ||
                (state.events.filter(e=>e.type==="emergency_stop_changed").at(-1)?.hash ?? null) !== reservation.stopEpoch) throw new Error("Learning mandate changed before dispatch.");
          });
          const performProviderCall = async (attempt: 0 | 1) => {
            await checkMandate();
            await this.serializeMutation(async () => {
              const current = await this.state();
              const priorStart = current.events.some(event => event.type === "learning_provider_call_started" &&
                (event.data as {jobId?:string;attempt?:number}).jobId === reservation.jobId &&
                (event.data as {attempt?:number}).attempt === attempt);
              if (priorStart) throw new Error("LEARNING_PROVIDER_CALL_ALREADY_STARTED");
              const job = current.jobs.find(candidate => candidate.id === reservation.jobId);
              await this.#store.append("learning_provider_call_started", SARA_PRINCIPAL, {
                jobId:reservation.jobId,campaignId:job?.learningCampaignId ?? null,contractDigest:job?.learningContractDigest ?? null,
                attempt,sameReservation:true,
              });
            });
            try {
              const proposal = await generator.generate(input);
              await checkMandate();
              await this.serializeMutation(() => this.#store.append("learning_provider_call_finished", SARA_PRINCIPAL, {
                jobId:reservation.jobId,attempt,status:"succeeded",proposalDigest:sha256(canonicalJson(proposal)),sameReservation:true,
              }));
              return proposal;
            } catch (error) {
              const triage = learningFailureTriage(error);
              await this.serializeMutation(() => this.#store.append("learning_provider_call_finished", SARA_PRINCIPAL, {
                jobId:reservation.jobId,attempt,status:"failed",failureClass:triage.failureClass,evidenceCode:triage.evidenceCode,sameReservation:true,
              }));
              throw error;
            }
          };
          if (reservation.nextProviderAttempt === 1) return performProviderCall(1);
          try {
            return await performProviderCall(0);
          } catch (firstError) {
            const firstTriage = learningFailureTriage(firstError);
            if (firstTriage.failureClass !== "provider_transient" || firstTriage.nextAction !== "retry_same_reservation") throw firstError;
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
            try {
              const proposal = await performProviderCall(1);
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
      });'''
text=text[:m.start()]+block+text[m.end():]

# Safe, non-secret runtime snapshot used only for production verification logs.
marker='''  /** Scheduler entrypoint: recovery/qualification precedes new generation. */'''
snapshot='''  async learningOperationalSnapshot() {
    const state = await this.state();
    const campaign = currentLearningCampaign(state.events);
    return {
      campaign: campaign ? { id: campaign.id, accounting: campaignAccounting(campaign, state.events) } : null,
      mandate: state.standingMandate ? { active: true, digest: state.standingMandate.digest } : { active: false, digest: null },
      latestAuditSequence: state.events.at(-1)?.sequence ?? 0,
      jobs: state.jobs.filter(job => job.workCard.requiredCapabilities.includes("autonomous-learning")).map(job => ({
        id:job.id,status:job.status,campaignId:job.learningCampaignId ?? null,capabilityId:job.learningCapabilityId ?? null,
        contractDigest:job.learningContractDigest ?? null,sourceJobId:job.learningSourceJobId ?? null,parentJobId:job.learningParentJobId ?? null,rootJobId:job.learningRootJobId ?? null,
      })),
      mutations: state.mutations.map(mutation => ({ id:mutation.id,jobId:mutation.jobId,stage:mutation.stage,candidateDigest:mutation.candidateDigest })),
      qualifications: state.events.filter(event => ["learning_qualification_passed","learning_qualification_failed","learning_qualification_readiness_checked"].includes(event.type)).slice(-12).map(event => ({sequence:event.sequence,type:event.type,data:event.data})),
      failureMemories: state.memories.filter(memory => (memory.tags ?? []).some(tag => tag.startsWith("learning-") || tag.startsWith("failure-class:"))).map(memory => ({id:memory.id,status:memory.status ?? "active",tags:memory.tags ?? [],dependencies:memory.dependencies})),
    };
  }

'''+marker
assert text.count(marker)==1
text=text.replace(marker,snapshot)
p.write_text(text)

# Worker emits safe startup and post-tick snapshots, plus result, for exact live-state verification.
p=Path('src/autonomous-learning-worker.ts'); text=p.read_text()
text=text.replace('''  async tick() {
    if (this.running) return {status:"blocked" as const};
    this.running = true;
    try { return await this.kernel.runLearningWorkerTick(this.generator); }
    finally { this.running = false; }
  }
  start() {
    if (this.timer) return;
    const tick = () => { void this.tick().catch(() => {
''','''  async tick() {
    if (this.running) return {status:"blocked" as const};
    this.running = true;
    try {
      const result = await this.kernel.runLearningWorkerTick(this.generator);
      console.info(JSON.stringify({event:"sara_learning_tick",result,snapshot:await this.kernel.learningOperationalSnapshot()}));
      return result;
    } finally { this.running = false; }
  }
  start() {
    if (this.timer) return;
    void this.kernel.learningOperationalSnapshot().then(snapshot => console.info(JSON.stringify({event:"sara_learning_startup",snapshot}))).catch(() => {});
    const tick = () => { void this.tick().catch(() => {
''')
p.write_text(text)
print('hardening applied')