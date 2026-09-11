from pathlib import Path


def exact_replace(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} occurrences, found {count}: {old!r}")
    p.write_text(text.replace(old, new, expected))

campaign_old = '''/** Select only actual unmet task requirements; no model calls or invented demand. */
export function selectLearningGap(campaign: LearningCampaign, jobs: Job[], events: StoredEvent[]) {
  const attempted = new Set(events.filter(event => event.type === "learning_gap_selected")
    .map(event => (event.data as { capabilityId: string }).capabilityId));
  const choices = campaign.contracts.filter(contract => !attempted.has(contract.capabilityId)).flatMap(contract =>
    jobs.filter(job => !job.learningCampaignId && !job.workCard.requiredCapabilities.includes("autonomous-learning") &&
      job.status !== "verified" && job.status !== "running" && job.workCard.expectedOwnerValue > 0 &&
      job.workCard.missingCapabilities.includes(contract.capabilityId))
      .map(job => ({ contract, sourceJob: job, score: job.workCard.expectedOwnerValue / contract.estimatedEffort })));
  return choices.sort((a, b) => b.score - a.score || a.contract.capabilityId.localeCompare(b.contract.capabilityId) ||
    a.sourceJob.id.localeCompare(b.sourceJob.id))[0];
}
'''
campaign_new = '''/** Select only actual unmet task requirements; no model calls or invented demand.
 * A terminal failed attempt may be re-selected only inside the same bounded four-attempt root. */
export function selectLearningGap(campaign: LearningCampaign, jobs: Job[], events: StoredEvent[]) {
  void events;
  const choices = campaign.contracts.flatMap(contract =>
    jobs.filter(job => !job.learningCampaignId && !job.workCard.requiredCapabilities.includes("autonomous-learning") &&
      job.status !== "verified" && job.status !== "running" && job.workCard.expectedOwnerValue > 0 &&
      job.workCard.missingCapabilities.includes(contract.capabilityId))
      .flatMap(sourceJob => {
        const attempts = jobs.filter(job => job.learningCampaignId === campaign.id &&
          job.learningCapabilityId === contract.capabilityId && job.learningSourceJobId === sourceJob.id);
        if (attempts.some(job => ["authorized", "running", "verified"].includes(job.status))) return [];
        if (!attempts.length) return [{ contract, sourceJob, score: sourceJob.workCard.expectedOwnerValue / contract.estimatedEffort,
          retry: false as const, retryParentJobId: undefined, retryRootJobId: undefined }];
        const latest = attempts.at(-1)!;
        const rootJobId = attempts[0]!.learningRootJobId ?? attempts[0]!.id;
        const rootAttempts = attempts.filter(job => job.id === rootJobId || job.learningRootJobId === rootJobId).length;
        if (latest.status !== "failed" || rootAttempts >= LEARNING_MAXIMUM_ATTEMPTS_PER_ROOT) return [];
        return [{ contract, sourceJob, score: sourceJob.workCard.expectedOwnerValue / contract.estimatedEffort,
          retry: true as const, retryParentJobId: latest.id, retryRootJobId: rootJobId }];
      }));
  return choices.sort((a, b) => Number(a.retry) - Number(b.retry) || b.score - a.score ||
    a.contract.capabilityId.localeCompare(b.contract.capabilityId) || a.sourceJob.id.localeCompare(b.sourceJob.id))[0];
}
'''
exact_replace("src/learning-campaign.ts", campaign_old, campaign_new)

kernel_old = '''      const job: Job = { id: randomUUID(), kind: "self_development", status: "authorized",
        learningCampaignId: campaign.id, learningCapabilityId: choice.contract.capabilityId,
        learningContractDigest: contractDigest, learningSourceJobId: choice.sourceJob.id,
        workCard: compileWorkCard({ objective: choice.contract.objective, expectedOwnerValue: choice.sourceJob.workCard.expectedOwnerValue,
          requiredCapabilities: ["autonomous-learning", choice.contract.capabilityId], acceptanceCriteria: choice.contract.publicCriteria,
          maximumBudgetUsd: 0, availableCapabilities: state.capabilities, prohibitedActions: [...this.#constitution.protectedActions] }) };
      // One atomic event carries the job and selection, eliminating a crash gap.
      await this.#store.append("learning_gap_selected", SARA_PRINCIPAL, { campaignId: campaign.id, capabilityId: choice.contract.capabilityId,
        contractDigest, sourceJobId: choice.sourceJob.id, score: choice.score,
        reason: "Unmet authorized capability; ranked by declared owner value divided by estimated effort. Value is not measured profit.", job });
'''
kernel_new = '''      const job: Job = { id: randomUUID(), kind: "self_development", status: "authorized",
        learningCampaignId: campaign.id, learningCapabilityId: choice.contract.capabilityId,
        learningContractDigest: contractDigest, learningSourceJobId: choice.sourceJob.id,
        ...(choice.retryParentJobId ? { learningParentJobId: choice.retryParentJobId, learningRootJobId: choice.retryRootJobId } : {}),
        workCard: compileWorkCard({ objective: choice.contract.objective, expectedOwnerValue: choice.sourceJob.workCard.expectedOwnerValue,
          requiredCapabilities: ["autonomous-learning", choice.contract.capabilityId], acceptanceCriteria: choice.contract.publicCriteria,
          maximumBudgetUsd: 0, availableCapabilities: state.capabilities, prohibitedActions: [...this.#constitution.protectedActions] }) };
      // One atomic event carries the job and selection, eliminating a crash gap.
      await this.#store.append("learning_gap_selected", SARA_PRINCIPAL, { campaignId: campaign.id, capabilityId: choice.contract.capabilityId,
        contractDigest, sourceJobId: choice.sourceJob.id, score: choice.score,
        retryParentJobId: choice.retryParentJobId ?? null, retryRootJobId: choice.retryRootJobId ?? null,
        reason: choice.retry ? "Still-unmet owner-authorized capability; bounded retry retains the original four-attempt root." :
          "Unmet authorized capability; ranked by declared owner value divided by estimated effort. Value is not measured profit.", job });
'''
exact_replace("src/kernel.ts", kernel_old, kernel_new)

anchor = '''test("pure initial generation rejects constructor destructuring before execution",async()=>{'''
insert = '''test("unknown terminal failures replenish the same frozen gap only within the four-attempt root",async()=>{
  const {directory,kernel}=await setup();let calls=0;
  const generator:CandidateGenerator={...echo,async generate(){calls++;throw new Error("Unknown provider failure");}};
  try {
    const worker=new AutonomousLearningWorker(kernel,generator);
    assert.equal((await worker.tick()).status,"failed");
    assert.equal((await worker.tick()).status,"failed");
    assert.equal((await worker.tick()).status,"failed");
    assert.equal((await worker.tick()).status,"failed");
    assert.equal((await worker.tick()).status,"idle");
    assert.equal(calls,4);
    const state=await kernel.getStatus();
    const attempts=state.jobs.filter(job=>job.learningCampaignId===config.id);
    assert.equal(attempts.length,4);
    const root=attempts[0]!;
    assert.deepEqual(attempts.slice(1).map(job=>job.learningRootJobId),[root.id,root.id,root.id]);
    assert.deepEqual(attempts.slice(1).map(job=>Boolean(job.learningParentJobId)),[true,true,true]);
    assert.equal((await kernel.learningCampaignStatus()).campaign?.reserved,4);
    assert.equal((await kernel.learningCampaignStatus()).selections.length,4);
  }finally{await rm(directory,{recursive:true,force:true});}
});

''' + anchor
exact_replace("tests/learning-campaign.test.ts", anchor, insert)
