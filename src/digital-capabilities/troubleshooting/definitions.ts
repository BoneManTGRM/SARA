import type { CapabilityDefinition } from '../types.ts';
import { schemas } from './contracts.ts';
import { cases } from './qualification.ts';
import { cluster, designExperiment, escalation, reconstruct, resolveBlockers, retry } from './implementations.ts';
const entries:Record<string,{description:string;execute:CapabilityDefinition['execute'];draft?:boolean}>={
 'failure-clusterer':{description:'Group deduplicated bounded failure evidence by subsystem and normalized stack signature; preserve uncertainty about common root causes.',execute:cluster},
 'diagnostic-experiment-designer':{description:'Rank supplied safe diagnostic experiments by distinguished hypothesis pairs, supplied cost and duration; reject production mutations and incomplete predictions.',execute:designExperiment,draft:true},
 'retry-worthiness-classifier':{description:'Classify objective failure signatures and stop deterministic, unauthorized, over-budget or ambiguous external retries; never execute retries.',execute:retry},
 'recovery-state-reconstructor':{description:'Reconstruct completed, pending and uncertain work from an exact trusted durable snapshot while preserving accounting; supplied journals alone never establish safe continuation.',execute:reconstruct},
 'blocked-work-resolver':{description:'Trace incomplete dependency roots, missing records and cycles; distinguish evidence, authority, capability, outage, policy, economic and human boundaries.',execute:resolveBlockers},
 'escalation-quality-controller':{description:'Validate precise evidence-backed owner decision drafts, attempted alternatives and choice consequences without sending a notification.',execute:escalation,draft:true},
};
export const troubleshootingDefinitions:readonly CapabilityDefinition[]=Object.entries(entries).map(([id,e])=>({id,version:'1.0.0',description:e.description,inputSchema:schemas[id]!.input,outputSchema:schemas[id]!.output,effect:e.draft?'DRAFT_ONLY':'PURE',authorityClass:e.draft?'DRAFT_ONLY':'READ_ONLY',resources:['supplied-input','actor-visible-kernel-evidence-receipts','kernel-durable-recovery-snapshot'],sourceFiles:['troubleshooting/durable.ts','troubleshooting/contracts.ts','troubleshooting/definitions.ts','troubleshooting/implementations.ts','troubleshooting/qualification.ts','engineering/common.ts'],qualificationRequirements:['frozen-contract','malformed-input','determinism','no-external-effect','evidence-provenance','negative-and-boundary-cases','kernel-replay-and-recovery'],execute:e.execute,cases:cases[id]!}));
