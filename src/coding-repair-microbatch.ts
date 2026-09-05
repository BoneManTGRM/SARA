export type CodingMicroBatchTask = { id: string; objective: string; source: string };
export type CodingMicroBatchProposal = { id: string; source: string };
export type CodingMicroBatchUsage = {
  accountedCostUsd: number; inputTokens: number; outputTokens: number; elapsedMilliseconds: number;
};
export type CodingMicroBatchModel = {
  /** The adapter must reserve this ceiling before external spending. */
  proposeBatch(tasks: readonly CodingMicroBatchTask[], maximumSpendUsd?: number): Promise<CodingMicroBatchUsage & {proposals: CodingMicroBatchProposal[]}>;
  proposeSingle(task: CodingMicroBatchTask, maximumSpendUsd?: number): Promise<CodingMicroBatchUsage & {proposal: CodingMicroBatchProposal}>;
};
export type CodingMicroBatchVerification = { passed: boolean; score: number };
type MemberResult = { id: string; passed: boolean; score: number; attempts: number };
export type CodingMicroBatchFailureEvidence = {
  schemaVersion: 1;
  modelCalls: number;
  accountedCostUsd: number | null;
  knownCostUsd: number;
  unknownCostReservationUsd: number;
  inputTokens: number | null;
  outputTokens: number | null;
  results: MemberResult[];
  failureStages: string[];
  generalClaimSupported: false;
};
/** Partial work survives exceptions. No provider messages, causes or source enter this evidence. */
export class CodingMicroBatchExecutionError extends Error {
  readonly evidence: CodingMicroBatchFailureEvidence;
  constructor(message: string, evidence: CodingMicroBatchFailureEvidence) {
    super(message); this.name = 'CodingMicroBatchExecutionError'; this.evidence = structuredClone(evidence);
  }
}
export type CodingMicroBatchResult = {
  schemaVersion: 1; evidenceLevel: 'DETERMINISTIC_MICROBATCH_MECHANISM';
  verifiedComplete: number; totalTasks: number; modelCalls: number; inputTokens: number; outputTokens: number;
  accountedCostUsd: number; activeModelMilliseconds: number; modelCallThroughputRatio: number | null;
  modelCallThroughputIncreasePercent: number | null;
  /** Legacy name: all supplied tasks passed their verifier, not a comparative accuracy measurement. */
  accuracyPreserved: boolean;
  results: MemberResult[]; generalClaimSupported: false;
};
const MAX_BATCH_TASKS = 4;
const MAX_EXPERIMENT_SPEND_USD = .15;
function assertUsage(usage: CodingMicroBatchUsage): void {
  if (!usage || !Number.isFinite(usage.accountedCostUsd) || usage.accountedCostUsd < 0 ||
      !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 ||
      !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0 ||
      !Number.isFinite(usage.elapsedMilliseconds) || usage.elapsedMilliseconds < 0) {
    throw new Error('Coding micro-batch returned malformed usage accounting.');
  }
}
function assertVerification(value: CodingMicroBatchVerification): void {
  if (!value || typeof value.passed !== 'boolean' || !Number.isFinite(value.score) ||
      value.score < 0 || value.score > 1 || (value.passed && value.score !== 1)) {
    throw new Error('Coding micro-batch returned malformed verification.');
  }
}
function assertProposalIdentities(tasks: readonly CodingMicroBatchTask[], proposals: readonly CodingMicroBatchProposal[]): void {
  if (!Array.isArray(proposals) || proposals.some(p=>!p || typeof p.id !== 'string' || typeof p.source !== 'string')) throw new Error('Coding micro-batch proposal identities are malformed.');
  const expected = new Set(tasks.map(t=>t.id)), actual = new Set(proposals.map(p=>p.id));
  if (actual.size !== proposals.length || actual.size !== expected.size || [...actual].some(id=>!expected.has(id))) throw new Error('Coding micro-batch proposal identities are malformed.');
}
export async function runVerifiedCodingMicroBatch(input: {
  tasks: readonly CodingMicroBatchTask[]; maximumSpendUsd: number; model: CodingMicroBatchModel;
  verify(task: CodingMicroBatchTask, candidateSource: string): Promise<CodingMicroBatchVerification>;
}): Promise<CodingMicroBatchResult> {
  if (input.tasks.length < 1 || input.tasks.length > MAX_BATCH_TASKS) throw new Error(`Coding micro-batch requires between 1 and ${MAX_BATCH_TASKS} tasks.`);
  const tasks = structuredClone(input.tasks), ids = new Set<string>();
  for (const task of tasks) {
    if (typeof task.id !== 'string' || !task.id.trim() || ids.has(task.id)) throw new Error('Coding micro-batch task ids must be unique and non-empty.');
    ids.add(task.id);
  }
  const maximumSpendUsd = input.maximumSpendUsd;
  if (!Number.isFinite(maximumSpendUsd) || maximumSpendUsd <= 0 || maximumSpendUsd > MAX_EXPERIMENT_SPEND_USD) throw new Error('Coding micro-batch spend ceiling is invalid or exceeds $0.15.');
  let modelCalls=0, inputTokens=0, outputTokens=0, accountedCostUsd=0, activeModelMilliseconds=0;
  let unknownReservations=0, unknownCalls=0, message='Coding micro-batch execution failed.';
  const stages: string[]=[]; const costs: number[]=[];
  const members=new Map(tasks.map(t=>[t.id,{id:t.id,passed:false,score:0,attempts:0}]));
  const results=()=>tasks.map(t=>({...members.get(t.id)!}));
  const account=(u:CodingMicroBatchUsage,reserve:number)=>{
    assertUsage(u); unknownReservations=Math.max(0,unknownReservations-reserve); unknownCalls--;
    costs.push(u.accountedCostUsd);
    accountedCostUsd=costs[0]+costs.slice(1).reduce((total,cost)=>total+cost,0);
    inputTokens+=u.inputTokens;outputTokens+=u.outputTokens;
  };
  const verify=async(task:CodingMicroBatchTask,source:string)=>{
    const v=await input.verify(structuredClone(task),source);assertVerification(v);
    Object.assign(members.get(task.id)!,{passed:v.passed,score:v.score}); return v;
  };
  try {
    modelCalls++;unknownCalls++;unknownReservations=maximumSpendUsd;
    let batch;
    try {batch=await input.model.proposeBatch(structuredClone(tasks),maximumSpendUsd);}
    catch {stages.push('batch_model');throw new Error();}
    try {account(batch,maximumSpendUsd);}
    catch {stages.push('batch_usage');message='Coding micro-batch returned malformed usage accounting.';throw new Error();}
    activeModelMilliseconds=batch.elapsedMilliseconds;
    if (accountedCostUsd > maximumSpendUsd+Number.EPSILON) {message='Coding micro-batch exceeded its configured spend ceiling.';stages.push('batch_budget');throw new Error();}
    try {assertProposalIdentities(tasks,batch.proposals);}
    catch {message='Coding micro-batch proposal identities are malformed.';stages.push('batch_identity');throw new Error();}
    const proposals=new Map(batch.proposals.map(p=>[p.id,p]));
    const failed: CodingMicroBatchTask[]=[];
    for (const task of tasks) {
      members.get(task.id)!.attempts=1;
      let v;
      try {v=await verify(task,proposals.get(task.id)!.source);}
      catch {stages.push('batch_verification');message='Coding micro-batch returned malformed or failed verification.';throw new Error();}
      if (!v.passed) failed.push(task);
    }
    if (failed.length) {
      const remaining=maximumSpendUsd-accountedCostUsd;
      if (remaining <= 0) {message='Coding micro-batch has no remaining spend for failed-member fallback.';stages.push('fallback_budget');throw new Error();}
      const ceiling=remaining/failed.length;
      // Reserve every request before dispatch; allSettled retains successful siblings on failure.
      modelCalls+=failed.length;unknownCalls+=failed.length;unknownReservations+=remaining;
      for(const t of failed)members.get(t.id)!.attempts=2;
      const settled=await Promise.allSettled(failed.map(async t=>input.model.proposeSingle(structuredClone(t),ceiling)));
      let maxFallbackMs=0, invalid=false;
      for(let i=0;i<settled.length;i++) {
        const row=settled[i], task=failed[i];
        if(row.status==='rejected'){stages.push('fallback_model');invalid=true;continue;}
        const response=row.value;
        try {account(response,ceiling);}
        catch {stages.push('fallback_usage');invalid=true;continue;}
        maxFallbackMs=Math.max(maxFallbackMs,response.elapsedMilliseconds);
        if(response.accountedCostUsd > ceiling+Number.EPSILON) {stages.push('fallback_budget');message='Coding micro-batch fallback exceeded its reserved spend ceiling.';invalid=true;continue;}
        if(!response.proposal || response.proposal.id!==task.id || typeof response.proposal.source!=='string') {stages.push('fallback_identity');message='Coding micro-batch fallback proposal identity does not match its task.';invalid=true;continue;}
        try {await verify(task,response.proposal.source);}
        catch {stages.push('fallback_verification');invalid=true;}
      }
      activeModelMilliseconds+=maxFallbackMs;
      if(invalid)throw new Error();
    }
    const complete=results().filter(r=>r.passed).length, accuracyPreserved=complete===tasks.length;
    const ratio=accuracyPreserved?complete/modelCalls:null;
    return {schemaVersion:1,evidenceLevel:'DETERMINISTIC_MICROBATCH_MECHANISM',verifiedComplete:complete,totalTasks:tasks.length,
      modelCalls,inputTokens,outputTokens,accountedCostUsd,activeModelMilliseconds,modelCallThroughputRatio:ratio,
      modelCallThroughputIncreasePercent:ratio===null?null:(ratio-1)*100,accuracyPreserved,results:results(),generalClaimSupported:false};
  } catch {
    throw new CodingMicroBatchExecutionError(message,{schemaVersion:1,modelCalls,accountedCostUsd:unknownCalls?null:accountedCostUsd,
      knownCostUsd:accountedCostUsd,unknownCostReservationUsd:unknownReservations,inputTokens:unknownCalls?null:inputTokens,
      outputTokens:unknownCalls?null:outputTokens,results:results(),failureStages:stages.length?stages:['unclassified_boundary'],generalClaimSupported:false});
  }
}
