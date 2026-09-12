import {canonicalJson,sha256} from '../canonical.ts';
import {SaraKernel,SARA_PRINCIPAL} from '../kernel.ts';
import {capabilityDefinition} from './registry.ts';
/** Harmless synthetic contract and denial probes, run through the serving kernel. */
export async function runSafeExpansionRuntimeProof(input:{kernel:SaraKernel;sourceRevision:string;deploymentId:string;environment:'ISOLATED'|'PRODUCTION'}) {
 if(!/^[a-f0-9]{40}$/.test(input.sourceRevision)||!/^[A-Za-z0-9-]{8,128}$/.test(input.deploymentId))throw new Error('RUNTIME_IDENTITY_REQUIRED');
 const {kernel}=input,before=await kernel.getStatus(),audit=await kernel.inspectAudit(),contracts=await kernel.inspectCapabilityContracts();
 const selected=contracts.filter(c=>capabilityDefinition(c.id)?.sourceFiles.some(p=>/^(troubleshooting|procedural|economic|business|secretary|self-management|nico|web|agents)\//.test(p)));
 const identity=sha256(canonicalJson({source:input.sourceRevision,deployment:input.deploymentId,contracts:selected.map(c=>c.contractDigest),authority:before.standingMandate,stop:before.emergencyStopped})).slice(0,20);
 const receipts=[],behaviors:Record<string,boolean>={};
 for(const contract of selected){const definition=capabilityDefinition(contract.id)!,fixture=definition.cases.find(c=>!c.context)??definition.cases[0]!;
  const fixtureInput=structuredClone(fixture.input) as Record<string,import('./schema.ts').Json>;
  // Absence probes must not assume the real procedure store is empty.
  if(definition.sourceFiles.some(p=>p.startsWith('procedural/'))&&!definition.ownerOnly){
   if('playbookId' in fixtureInput)fixtureInput.playbookId=`runtime-absence:${identity}`;
   if('taskFamily' in fixtureInput)fixtureInput.taskFamily=`runtime-absence:${identity}`;
   if(Array.isArray(fixtureInput.rules))fixtureInput.rules=fixtureInput.rules.map(r=>({...r as Record<string,import('./schema.ts').Json>,id:`runtime-absence:${identity}`}));
  }
  const result=await kernel.invokeCapability(SARA_PRINCIPAL,{requestId:`expansion-runtime:${identity}:${contract.id}`,capabilityId:contract.id,input:fixtureInput});
  receipts.push(result);behaviors[contract.id]=definition.ownerOnly?result.status==='BLOCKED':result.status==='SUCCEEDED'&&fixture.check({output:result.output});
 }
 const after=await kernel.getStatus(),afterAudit=await kernel.inspectAudit(),equal=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
 const checks={behaviorPredicates:Object.values(behaviors).every(Boolean),registeredQualified:selected.every(c=>c.status==='ENABLED'&&c.qualification.status==='PASSED'),
  noAuthorityIssued:receipts.every(r=>!r.authority.authorizationTokenIssued),zeroCash:receipts.every(r=>r.cost.actualCashMicroUsd===0&&r.cost.modelApiMicroUsd===0),
  currentReceipts:receipts.every(r=>r.receiptValidity?.current!==false),auditPreserved:equal(audit,afterAudit.slice(0,audit.length)),
  onlyComputationReceipts:afterAudit.slice(audit.length).every(e=>e.type==='digital_capability_executed'),constitutionPreserved:equal(before.constitution,after.constitution),
  stopPreserved:before.emergencyStopped===after.emergencyStopped,mandatePreserved:equal(before.standingMandate,after.standingMandate),
  financesPreserved:equal(before.realizedProfit,after.realizedProfit)&&before.reservedSelfDevelopmentBudgetUsd===after.reservedSelfDevelopmentBudgetUsd,
  memoryLearningPreserved:before.memoryCount===after.memoryCount&&equal(before.learning,after.learning)&&equal(before.mutations,after.mutations)};
 return {status:Object.values(checks).every(Boolean)?'VERIFIED':'NOT_VERIFIED',provenance:input.environment,sourceRevision:input.sourceRevision,deploymentId:input.deploymentId,
  scope:'Synthetic analysis and denied owner-only actions through the actual serving kernel. No customer completion, external browser, NICO production run, communication or revenue is claimed.',
  capabilityCount:selected.length,behaviors,checks,receiptDigests:receipts.map(r=>r.resultDigest),authorityDelta:0,audit:{before:audit.length,after:afterAudit.length,head:afterAudit.at(-1)?.hash??null}};
}
