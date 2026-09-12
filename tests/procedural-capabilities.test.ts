import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proceduralDefinitions } from '../src/digital-capabilities/procedural/definitions.ts';
import { validateSchema,type Json } from '../src/digital-capabilities/schema.ts';
import type { ExecutionContext } from '../src/digital-capabilities/types.ts';
const context:ExecutionContext={ownerAuthenticated:false,emergencyStopped:false,authorityContextDigest:'a'.repeat(64),constitutionDigest:'b'.repeat(64),mandateDigest:null,mandateId:null,evidence:[],currentIdentity:{},controls:[],policyDecision:{allowed:false,code:'NO_AUTHORITY',reason:'No mutation authorized'},benchmark:async()=>null};
test('eight memory capabilities satisfy strict deterministic frozen contracts',async()=>{
 assert.equal(proceduralDefinitions.length,8);
 for(const d of proceduralDefinitions)for(const c of d.cases){validateSchema(d.inputSchema,c.input);const ctx={...context,...c.context};const r=await d.execute(c.input as Record<string,Json>,ctx);validateSchema(d.outputSchema,r.output);assert.ok(c.check(r),`${d.id}/${c.name}`);assert.deepEqual(await d.execute(c.input as Record<string,Json>,ctx),r);}
});
import { ProceduralKnowledgeStore,PROCEDURAL_SEED_PLAYBOOKS,executeVerifiedProcedure,type ProceduralPlaybook,type ReuseTask } from '../src/procedural-intelligence.ts';
import { digest } from '../src/digital-capabilities/engineering/common.ts';
const source=()=>structuredClone(PROCEDURAL_SEED_PLAYBOOKS[0]!);
const reuseTask=(p:ProceduralPlaybook):ReuseTask=>({taskId:'task-1',description:'ci failure',taskFamily:p.taskFamily,identity:{...p.evidenceReuseIdentity,...p.procedureApplicabilityIdentity},requestedActions:[]});
async function runStored(store:ProceduralKnowledgeStore,p:ProceduralPlaybook,passed:boolean){return executeVerifiedProcedure({store,task:reuseTask(p),grantedAuthorities:p.authorityRequired,authorizedCostCeilingUsd:0,estimatedCostUsd:0,baselineOperations:['derive-new-procedure','fresh_verify'],variableWork:async()=>({fixture:true}),freshVerify:async()=>({passed,evidence:['fresh-independent-fixture-result']})});}
test('existing PR166 selection excludes failed version without erasing history or automatically restoring it',async()=>{
 const p=source();const store=ProceduralKnowledgeStore.inMemory([p]);const selection=store.select(reuseTask(p));
 await assert.rejects(()=>runStored(store,p,false),/FRESH_VERIFICATION_FAILED/);
 assert.throws(()=>store.select(reuseTask(p)),/NO_APPLICABLE_VERIFIED_PLAYBOOK/);
 await assert.rejects(()=>store.assertSelectionCurrent(selection,reuseTask(p)),/KNOWLEDGE_CHANGED_BEFORE_EXECUTION/);
 const failed=store.snapshot().outcomes[0]!;await store.recordOutcome({...failed,outcome:'VERIFIED'});
 assert.throws(()=>store.select(reuseTask(p)),/NO_APPLICABLE_VERIFIED_PLAYBOOK/);
 assert.equal(store.snapshot().playbooks[0]!.status,'VERIFIED');assert.equal(store.snapshot().outcomes.length,2);
});
import { mkdtemp,rm,cp,readFile,writeFile,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeProceduralCapability as executeProceduralRaw,type ProceduralContext } from '../src/digital-capabilities/procedural/implementations.ts';
import { conflictInput } from '../src/digital-capabilities/procedural/definitions.ts';
import { extractCandidateLesson } from '../src/procedural-intelligence.ts';
import { snapshotJson } from '../src/digital-capabilities/schema.ts';
async function executeProceduralCapability(...args:Parameters<typeof executeProceduralRaw>){const r=await executeProceduralRaw(...args);return {...r,output:r.output as Record<string,Json>};}
const definition=(id:string)=>{const d=proceduralDefinitions.find(d=>d.id===id);assert.ok(d);return d;};
async function invoke(id:string,input:unknown,ctx:ExecutionContext=context){const d=definition(id);const json=snapshotJson(input);validateSchema(d.inputSchema,json);const out=await d.execute(json as Record<string,Json>,ctx);validateSchema(d.outputSchema,out.output);return out.output as Record<string,Json>;}
const owned=(p:ProceduralPlaybook):ExecutionContext=>({...context,ownerAuthenticated:true,currentIdentity:reuseTask(p).identity,policyDecision:{allowed:true,code:'AUTHORIZED_RECORD_MEMORY',reason:'Existing owner record_memory permission'}});
const ctxWith=(store:ProceduralKnowledgeStore,p:ProceduralPlaybook):ProceduralContext=>({...owned(p),proceduralKnowledge:store.snapshot()});
test('memory closed contracts reject malformed, duplicate and injected trust values',async()=>{
 for(const d of proceduralDefinitions){assert.throws(()=>validateSchema(d.inputSchema,{}));assert.throws(()=>validateSchema(d.inputSchema,{...(d.cases[0]!.input as Record<string,Json>),proceduralKnowledge:{schemaVersion:1}}));}
 await assert.rejects(()=>invoke('confidence-calibrator',{taskFamily:'ci_failure_diagnosis',forecasts:[{taskReferenceDigest:'a'.repeat(64),probability:1.1,evidenceId:'fake'}]}));
 await assert.rejects(()=>invoke('knowledge-expiration-manager',{asOf:'2026-09-12T00:00:00',rules:[]}),/EXPLICIT_VALID_TIMEZONE/);
});
test('successful stored work compiles a durable candidate; interrupted receipt retry and copied restore do not duplicate or promote',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'procedural-capability-')),backup=await mkdtemp(join(tmpdir(),'procedural-copy-'));
 try{const p=source();const store=await ProceduralKnowledgeStore.open(dir,[p]);await runStored(store,p,true);const snapshot=store.snapshot();const input={playbookId:p.id,playbookVersion:1,outcomeDigests:[digest(snapshot.outcomes[0]!)],expectedKnowledgeDigest:digest(snapshot)};
 const denied=await executeProceduralCapability('experience-to-procedure-compiler',input,{...owned(p),ownerAuthenticated:false},dir);assert.equal((denied.output as Record<string,Json>).status,'BLOCKED');assert.equal((await ProceduralKnowledgeStore.inspectExisting(dir))!.generation,snapshot.generation);
 const result=await executeProceduralCapability('experience-to-procedure-compiler',input,owned(p),dir);validateSchema(definition('experience-to-procedure-compiler').outputSchema,result.output);const out=result.output as Record<string,Json>;assert.equal(out.persisted,true);const candidate=out.candidate as Record<string,Json>;assert.equal(candidate.status,'CANDIDATE');const first=(await ProceduralKnowledgeStore.inspectExisting(dir))!;assert.equal(first.playbooks.length,2);assert.equal(first.outcomes.length,1);
 // Simulated process interruption after durable store commit but before a kernel receipt is written.
 const restarted=await ProceduralKnowledgeStore.open(dir,[]);const second=await executeProceduralCapability('experience-to-procedure-compiler',input,owned(p),dir);assert.equal((second.output as Record<string,Json>).persisted,true);assert.equal((await ProceduralKnowledgeStore.inspectExisting(dir))!.generation,first.generation);assert.equal(restarted.select(reuseTask(p)).playbook.id,p.id);
 await cp(dir,backup,{recursive:true});const restored=await executeProceduralCapability('experience-to-procedure-compiler',input,owned(p),backup);assert.deepEqual(restored.output,second.output);assert.equal((await ProceduralKnowledgeStore.inspectExisting(backup))!.playbooks.length,2);
 await writeFile(join(restarted.directory,'pending-interrupted.json'),'{incomplete');assert.equal((await executeProceduralCapability('experience-to-procedure-compiler',input,owned(p),dir)).output.persisted,true);
 const corrupt=await readFile(restarted.statePath,'utf8');await writeFile(restarted.statePath,corrupt.replace('"generation":','"generation":999999,"oldGeneration":'));await assert.rejects(()=>executeProceduralCapability('experience-to-procedure-compiler',input,owned(p),dir),/PROCEDURAL/);
 }finally{await rm(dir,{recursive:true,force:true});await rm(backup,{recursive:true,force:true});}
});
test('failed, invented, stale and duplicate success claims do not become candidate procedures',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'procedural-fail-'));
 try{const p=source();const store=await ProceduralKnowledgeStore.open(dir,[p]);await runStored(store,p,true);const snapshot=store.snapshot();const good={playbookId:p.id,playbookVersion:1,outcomeDigests:[digest(snapshot.outcomes[0]!)],expectedKnowledgeDigest:digest(snapshot)};
 assert.equal((await executeProceduralCapability('experience-to-procedure-compiler',{...good,outcomeDigests:['f'.repeat(64)]},owned(p),dir)).output.status,'EVIDENCE_REQUIRED');
 await assert.rejects(()=>executeProceduralCapability('experience-to-procedure-compiler',{...good,expectedKnowledgeDigest:'f'.repeat(64)},owned(p),dir),/PROCEDURAL_STATE_CHANGED/);
 await assert.rejects(()=>executeProceduralCapability('experience-to-procedure-compiler',{...good,outcomeDigests:[...good.outcomeDigests,...good.outcomeDigests]},owned(p),dir),/DUPLICATE_OUTCOME/);
 assert.equal((await executeProceduralCapability('experience-to-procedure-compiler',good,{...owned(p),currentIdentity:{repository:'wrong'}},dir)).output.status,'EVIDENCE_REQUIRED');
 await assert.rejects(()=>runStored(store,p,false),/FRESH_VERIFICATION_FAILED/);assert.equal((await executeProceduralCapability('experience-to-procedure-compiler',good,owned(p),dir)).output.status,'EVIDENCE_REQUIRED');
 const measured=await invoke('procedure-effectiveness-scorer',{playbookId:p.id,playbookVersion:1},ctxWith(store,p));assert.equal(measured.successes,1);assert.equal(measured.failures,1);assert.equal(measured.successRate,.5);assert.equal(measured.operationsAvoided,2);assert.equal(measured.cashCostMicroUsd,null);
 const ranked=await invoke('solution-reuse-ranker',{taskFamily:p.taskFamily,maximumResults:5},ctxWith(store,p));assert.equal(ranked.selectedId,null);assert.ok(((ranked.ranking as Record<string,Json>[])[0]!.mismatchReasons as string[]).includes('VERSION_REUSE_FAILED_QUALIFY_NEW_VERSION'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('missing procedural storage stays absent after inspection and compile attempts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'procedural-absent-'));try{const p=source();assert.equal((await executeProceduralCapability('experience-to-procedure-compiler',{playbookId:p.id,playbookVersion:1,outcomeDigests:[],expectedKnowledgeDigest:null},owned(p),dir)).output.status,'EVIDENCE_REQUIRED');assert.deepEqual(await readdir(dir),[]);}finally{await rm(dir,{recursive:true,force:true});}
});
async function lesson(store:ProceduralKnowledgeStore,id:string,inference:string,nature:'POSITIVE'|'NEGATIVE'='NEGATIVE'){
 const l=extractCandidateLesson({id,taskFamily:source().taskFamily,nature,observation:'ETIMEDOUT database connection timeout',inference,confidence:.7,sourceEvidence:['frozen-independent-fixture'],producerIdentity:'fixture-producer',applicabilityIdentity:source().procedureApplicabilityIdentity,invalidationConditions:['SOURCE_CHANGED'],claimKey:'timeout-cause'});await store.addCandidateLesson(l);const proof={evaluatorIdentity:'independent-fixture-reviewer',sourceEvidence:['frozen-independent-proof'],qualificationDigest:'a'.repeat(64)};await store.qualifyLesson(id,1,proof);await store.publishLesson(id,1,proof);
}
test('conflicting lessons and bounded counterexamples preserve uncertainty and historical evidence',async()=>{
 const p=source();const store=ProceduralKnowledgeStore.inMemory([p]);await lesson(store,'network-cause','Network outage');await lesson(store,'pool-cause','Connection pool exhausted');const ctx=ctxWith(store,p);
 const c=await invoke('memory-conflict-resolver',conflictInput,ctx);assert.equal(c.status,'CONFLICTS_REQUIRE_REVIEW');assert.equal((c.conflicts as Json[]).length,1);assert.equal(store.snapshot().lessons.length,2);
 const counter=await invoke('counterexample-seeker',{taskFamily:p.taskFamily,claimKey:'timeout-cause',proposedInference:'All timeouts imply network outage',evidenceIds:['fake'],maximumItems:1},ctx);assert.equal(counter.status,'COUNTEREXAMPLES_FOUND');assert.equal(counter.examined,1);assert.equal(counter.remaining,1);assert.equal(counter.conclusionProven,false);
 const match=await invoke('failure-pattern-memory',{taskFamily:p.taskFamily,signature:'ETIMEDOUT database connection timeout',maximumResults:5},ctx);assert.equal((match.matches as Json[]).length,2);assert.equal((match.matches as Record<string,Json>[])[0]!.revalidationRequired,true);assert.equal(match.identityEstablished,false);
 const wrong=await invoke('failure-pattern-memory',{taskFamily:p.taskFamily,signature:'ETIMEDOUT database connection timeout',maximumResults:5},{...ctx,currentIdentity:{repository:'elsewhere'}});assert.equal((wrong.matches as Record<string,Json>[])[0]!.applicableNow,false);
});
test('knowledge class freshness keeps historical facts while marking time-sensitive knowledge for recheck',async()=>{
 const p=source(),store=ProceduralKnowledgeStore.inMemory([p]);const base={id:p.id,version:1,kind:'PLAYBOOK',maximumAgeSeconds:60};
 const fresh=await invoke('knowledge-expiration-manager',{asOf:'2026-09-12T00:00:00Z',rules:[{...base,nature:'TIME_SENSITIVE'}]},ctxWith(store,p));assert.equal((fresh.knowledge as Record<string,Json>[])[0]!.state,'REVERIFY');
 const historical=await invoke('knowledge-expiration-manager',{asOf:'2030-09-12T00:00:00Z',rules:[{...base,nature:'IMMUTABLE_HISTORICAL_FACT'}]},ctxWith(store,p));assert.equal((historical.knowledge as Record<string,Json>[])[0]!.state,'VALID');assert.equal(historical.historyChanged,false);
 const future=await invoke('knowledge-expiration-manager',{asOf:'2000-09-12T00:00:00Z',rules:[{...base,nature:'TIME_SENSITIVE'}]},ctxWith(store,p));assert.equal((future.knowledge as Record<string,Json>[])[0]!.state,'UNKNOWN');
});
test('confidence uses authentic forecasts preceding stored outcomes; invented and hindsight forecasts remain rejected',async()=>{
 const p=source(),store=ProceduralKnowledgeStore.inMemory([p]);await runStored(store,p,true);const outcome=store.snapshot().outcomes[0]!;const forecast={taskReferenceDigest:outcome.taskReferenceDigest,probability:.75};
 const proof={id:'forecast-1',sourceId:'predictor',contentDigest:digest(forecast),provenance:'LOCAL' as const,claimedProvenance:null,authoritySource:false as const,subject:{taskReferenceDigest:outcome.taskReferenceDigest,taskFamily:p.taskFamily},capturedAt:'2026-09-11T00:00:00Z',claims:['pre-outcome-forecast'],integrity:'KERNEL_RECEIPT' as const,receiptId:'forecast-receipt'};
 const input={taskFamily:p.taskFamily,forecasts:[{...forecast,evidenceId:proof.id}]};const ctx={...ctxWith(store,p),evidence:[proof]};const calibrated=await invoke('confidence-calibrator',input,ctx);assert.equal(calibrated.samples,1);assert.equal(calibrated.brierScore,.0625);assert.equal(calibrated.smoothedProbability,2/3);assert.equal(calibrated.generalizationProven,false);
 for(const patch of [{capturedAt:'2099-01-01T00:00:00Z'},{provenance:'SUPPLIED' as const},{contentDigest:'f'.repeat(64)},{subject:{taskFamily:'wrong'}}])assert.equal((await invoke('confidence-calibrator',input,{...ctx,evidence:[{...proof,...patch}]})).status,'INSUFFICIENT_EVIDENCE');
});
import { proceduralDependencyDigest } from '../src/digital-capabilities/procedural/implementations.ts';
test('owner applies exact freshly qualified replacement; supersession survives interrupted receipt replay and backup',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'procedural-supersede-')),backup=await mkdtemp(join(tmpdir(),'procedural-supersede-copy-'));
 try{const p=source(),store=await ProceduralKnowledgeStore.open(dir,[p]);await runStored(store,p,true);
 const replacement:ProceduralPlaybook={...structuredClone(p),id:'replacement-procedure',status:'CANDIDATE',qualificationStatus:'pending',qualificationDigest:'',evaluatorIdentity:'unassigned',verifiedAt:null,qualificationStrength:101};await store.addCandidatePlaybook(replacement);
 const proof={evaluatorIdentity:'fresh-independent-reviewer',sourceEvidence:['replacement-positive','replacement-negative'],qualificationDigest:'b'.repeat(64)};await store.qualifyPlaybook(replacement.id,1,proof);await store.publishPlaybook(replacement.id,1,proof);assert.equal((await runStored(store,replacement,true)).playbook.id,replacement.id);
 const snapshot=store.snapshot();const old=snapshot.playbooks.find(p=>p.id===source().id)!,newer=snapshot.playbooks.find(p=>p.id===replacement.id)!;
 const input={...conflictInput,operation:'SUPERSEDE',oldId:old.id,oldVersion:1,replacementId:newer.id,replacementVersion:1,oldDigest:digest(old),replacementDigest:digest(newer),expectedKnowledgeDigest:digest(snapshot)};
 assert.equal((await executeProceduralCapability('memory-conflict-resolver',input,{...owned(p),emergencyStopped:true},dir)).output.status,'BLOCKED');
 await assert.rejects(()=>executeProceduralCapability('memory-conflict-resolver',{...input,oldDigest:'f'.repeat(64)},owned(p),dir),/PROCEDURAL_STATE_CHANGED/);
 const applied=await executeProceduralCapability('memory-conflict-resolver',input,owned(p),dir);validateSchema(definition('memory-conflict-resolver').outputSchema,applied.output);assert.equal(applied.output.status,'SUPERSEDED');const after=(await ProceduralKnowledgeStore.inspectExisting(dir))!;assert.equal(after.invalidations.length,1);assert.deepEqual(after.playbooks.find(p=>p.id===old.id)!.sourceEvidence,old.sourceEvidence);assert.equal(after.outcomes.length,snapshot.outcomes.length);
 const repeat=await executeProceduralCapability('memory-conflict-resolver',input,owned(p),dir);assert.deepEqual(repeat.output,applied.output);assert.equal((await ProceduralKnowledgeStore.inspectExisting(dir))!.generation,after.generation);
 await cp(dir,backup,{recursive:true});assert.deepEqual((await executeProceduralCapability('memory-conflict-resolver',input,owned(p),backup)).output,applied.output);assert.equal((await ProceduralKnowledgeStore.open(backup,[])).select(reuseTask(p)).playbook.id,newer.id);
 }finally{await rm(dir,{recursive:true,force:true});await rm(backup,{recursive:true,force:true});}
});
test('failed exact version requires independent qualification of a new version before reuse',async()=>{
 const p=source(),store=ProceduralKnowledgeStore.inMemory([p]);await assert.rejects(()=>runStored(store,p,false),/FRESH_VERIFICATION_FAILED/);
 const replacement={...structuredClone(p),version:2,status:'CANDIDATE' as const,qualificationStatus:'pending',qualificationDigest:'',evaluatorIdentity:'unassigned',verifiedAt:null};await store.addCandidatePlaybook(replacement);assert.throws(()=>store.select(reuseTask(p)),/NO_APPLICABLE/);
 const evidence={evaluatorIdentity:'independent-new-version-review',sourceEvidence:['new-positive-case','new-negative-case'],qualificationDigest:'c'.repeat(64)};await store.qualifyPlaybook(p.id,2,evidence);assert.throws(()=>store.select(reuseTask(p)),/NO_APPLICABLE/);await store.publishPlaybook(p.id,2,evidence);assert.equal(store.select(reuseTask(p)).playbook.version,2);assert.equal(store.snapshot().outcomes[0]!.outcome,'FAILED');
});
test('procedural dependency identity preserves unchanged proof across unrelated knowledge changes',async()=>{
 const p=source(),store=ProceduralKnowledgeStore.inMemory([p]);await runStored(store,p,true);const snapshot=store.snapshot();const changed=structuredClone(snapshot);changed.generation++;changed.playbooks.push({...structuredClone(p),id:'unrelated',taskFamily:'other_task_family'});
 for(const id of ['procedure-effectiveness-scorer','solution-reuse-ranker','failure-pattern-memory','counterexample-seeker','confidence-calibrator','knowledge-expiration-manager']){
 const input={playbookId:p.id,playbookVersion:1,taskFamily:p.taskFamily,claimKey:'timeout-cause',rules:[{id:p.id,version:1,kind:'PLAYBOOK'}],forecasts:[]};assert.equal(proceduralDependencyDigest(id,input,snapshot),proceduralDependencyDigest(id,input,changed),id);}
 const changedRelevant=structuredClone(snapshot);changedRelevant.outcomes.push({...snapshot.outcomes[0]!,outcome:'FAILED'});assert.notEqual(proceduralDependencyDigest('solution-reuse-ranker',{taskFamily:p.taskFamily},snapshot),proceduralDependencyDigest('solution-reuse-ranker',{taskFamily:p.taskFamily},changedRelevant));
 const ranked=await invoke('solution-reuse-ranker',{taskFamily:p.taskFamily,maximumResults:5},{...owned(p),proceduralKnowledge:changed} as ProceduralContext);assert.equal(ranked.selectedId,p.id);assert.equal((ranked.ranking as Json[]).length,1);
});
test('concurrent candidate compilers retain a single candidate and existing outcome history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'procedural-concurrent-'));try{const p=source(),store=await ProceduralKnowledgeStore.open(dir,[p]);await runStored(store,p,true);const snapshot=store.snapshot();const input={playbookId:p.id,playbookVersion:1,outcomeDigests:[digest(snapshot.outcomes[0]!)],expectedKnowledgeDigest:digest(snapshot)};
 const attempts=await Promise.allSettled([executeProceduralCapability('experience-to-procedure-compiler',input,owned(p),dir),executeProceduralCapability('experience-to-procedure-compiler',input,owned(p),dir)]);assert.ok(attempts.some(r=>r.status==='fulfilled'));for(const r of attempts)if(r.status==='rejected')assert.match(String(r.reason),/EEXIST|PROCEDURAL_STATE_CONCURRENT_CHANGE|PROCEDURAL_STATE_CHANGED/);
 const after=(await ProceduralKnowledgeStore.inspectExisting(dir))!;assert.equal(after.playbooks.filter(p=>p.status==='CANDIDATE').length,1);assert.equal(after.outcomes.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('measured procedure economics and quality require bound trusted paired observations',async()=>{
 const p=source(),store=ProceduralKnowledgeStore.inMemory([p]);await runStored(store,p,true);const taskReferenceDigest=store.snapshot().outcomes[0]!.taskReferenceDigest;
 const base={taskReferenceDigest,comparisonId:'frozen-comparison',basisDigest:'d'.repeat(64),elapsedMs:1000,cashMicroUsd:100,retries:2,humanInterventions:1,regressions:1,regressionOpportunities:10};
 const baseline={...base,group:'BASELINE',evidenceId:'baseline-proof'},reuse={...base,group:'REUSE',evidenceId:'reuse-proof',elapsedMs:500,cashMicroUsd:40,retries:0,humanInterventions:0,regressions:0};
 const proof=(r:typeof baseline)=>{const{evidenceId,...material}=r;return{id:evidenceId,sourceId:'independent-observer',contentDigest:digest(material),provenance:'OWNER_OBSERVED' as const,claimedProvenance:null,authoritySource:false as const,subject:{playbookId:p.id,playbookVersion:1,taskReferenceDigest,comparisonId:r.comparisonId,basisDigest:r.basisDigest},capturedAt:'2026-09-12T12:00:00Z',claims:['procedure-performance-measurement'],integrity:'KERNEL_RECEIPT' as const,receiptId:evidenceId};};
 const input={playbookId:p.id,playbookVersion:1,measurements:[baseline,reuse]},ctx={...ctxWith(store,p),evidence:[proof(baseline),proof(reuse)]};
 const measured=await invoke('procedure-effectiveness-scorer',input,ctx);assert.equal(measured.completionTimeMs,500);assert.equal(measured.cashCostMicroUsd,40);assert.equal(measured.retryCount,0);assert.equal(measured.humanInterventions,0);assert.equal(measured.regressionRate,0);assert.deepEqual(measured.comparisons,{pairedSamples:1,meanTimeSavedMs:500,cashSavedMicroUsd:60,meanRetryReduction:2,meanHumanInterventionReduction:1,meanRegressionRateReduction:.1});
 const supplied=await invoke('procedure-effectiveness-scorer',input,{...ctx,evidence:ctx.evidence.map(e=>({...e,provenance:'SUPPLIED' as const}))});assert.equal(supplied.cashCostMicroUsd,null);assert.equal((supplied.rejectedMeasurementDigests as Json[]).length,2);
 const invented=await invoke('procedure-effectiveness-scorer',{...input,measurements:[{...reuse,cashMicroUsd:999}]},ctx);assert.equal(invented.cashCostMicroUsd,null);
 const unrelated={...reuse,basisDigest:'e'.repeat(64)};const unpaired=await invoke('procedure-effectiveness-scorer',{...input,measurements:[baseline,unrelated]},{...ctx,evidence:[proof(baseline),proof(unrelated)]});assert.equal(unpaired.cashCostMicroUsd,40);assert.equal((unpaired.comparisons as Record<string,Json>).pairedSamples,0);assert.equal((unpaired.comparisons as Record<string,Json>).cashSavedMicroUsd,null);
 const invalid={...reuse,regressions:11};const invalidResult=await invoke('procedure-effectiveness-scorer',{...input,measurements:[invalid]},{...ctx,evidence:[proof(invalid)]});assert.equal(invalidResult.regressionRate,null);
 await assert.rejects(()=>invoke('procedure-effectiveness-scorer',{...input,measurements:[reuse,reuse]},ctx),/DUPLICATE_PERFORMANCE/);
 await assert.rejects(()=>invoke('procedure-effectiveness-scorer',{...input,measurements:[{...reuse,cashMicroUsd:-1}]},ctx));
});
