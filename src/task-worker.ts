import {canonicalJson,sha256} from './canonical.ts';
import {bountyTarget} from './second-brain-bounty.ts';
import {validateProgramCandidateStructure,assertBoundedProgramSource,buildVerifiedSkillCandidate,GenomeLabBehaviorError} from './genome-lab.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ProgramCandidateProposal} from './types.ts';
import type {ProgramVerificationResult} from './coding-repair-types.ts';

type TaskPackage={version:'task-worker-v1';source:string;revision:string;objective:string;baseline:ProgramCandidateProposal;proposals:{path:string;before:string;content:string}[]};
export function isOrdinaryBehaviorExit(cause: unknown): boolean {
 if(!cause||typeof cause!=='object')return false;
 const exit=cause as {code?:unknown;killed?:unknown;signal?:unknown};
 return exit.code===1&&exit.killed!==true&&(exit.signal===null||exit.signal===undefined);
}
// Reuse the canonical builder directly: historical verifier output intentionally
// conflates runtime exits and resource failures and cannot qualify a task baseline.
async function verifyTask(candidate:ProgramCandidateProposal,objective:string,constitutionDigest:string,baseline=false):Promise<ProgramVerificationResult>{
 const files=candidate.files.map(f=>({path:f.path,contentDigest:sha256(f.content)})).sort((a,b)=>a.path.localeCompare(b.path));
 const artifactDigest=sha256(canonicalJson({schemaVersion:1,files})),root=await mkdtemp(join(tmpdir(),'sara-task-'));
 try{
  await buildVerifiedSkillCandidate({schemaVersion:1,role:'sandboxed_coding_executor',jobId:randomUUID(),constitutionDigest,objective,acceptanceCriteria:['Pass unchanged supplied tests.'],missingCapabilities:[],maximumBudgetUsd:0,prohibitedActions:[],requiredProcess:[],requiredOutput:[]},candidate,root,randomUUID());
  return {passed:true,score:1,artifactDigest,failures:[],completedChecks:['source_policy','syntax','typecheck','behavior_tests','artifact_integrity'],evidenceDigests:[sha256(canonicalJson({artifactDigest,result:'PASS'}))]};
 }catch(error){
  const behavior=error instanceof GenomeLabBehaviorError&&isOrdinaryBehaviorExit(error.cause),code=behavior?'TASK_BEHAVIOR_FAILURE':'TASK_BASELINE_UNQUALIFIED',digest=sha256(canonicalJson({artifactDigest,code}));
  return {passed:false,score:0,artifactDigest,failures:[{kind:behavior?'behavior':'unknown',code,file:'',line:0,column:0,evidenceDigest:digest,fingerprint:digest,severity:'high',existedBeforeRepair:baseline}],completedChecks:['artifact_integrity'],evidenceDigests:[digest]};
 }finally{await rm(root,{recursive:true,force:true});}
}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Task object required.');return v as Record<string,unknown>;}
function keys(v:Record<string,unknown>,allowed:string[]){if(Object.keys(v).length!==allowed.length||Object.keys(v).some(k=>!allowed.includes(k)))throw new Error('Unsupported task fields.');}
/** Supplied source identity is a claim, not an authenticated repository checkout. */
export function validateTaskPackage(raw:unknown):TaskPackage{
 const x=object(raw);keys(x,['version','source','revision','objective','baseline','proposals']);
 if(x.version!=='task-worker-v1'||typeof x.revision!=='string'||!/^[a-f0-9]{40}$/.test(x.revision)||typeof x.objective!=='string'||!x.objective.trim()||x.objective.length>1000)throw new Error('Invalid task identity.');
 bountyTarget(x.source);
 if(Buffer.byteLength(canonicalJson(x))>48000)throw new Error('Task package exceeds 48 KB.');
 const baseline=object(x.baseline);keys(baseline,['schemaVersion','candidateKind','programName','summary','files','limitations']);
 if(baseline.schemaVersion!==1||baseline.candidateKind!=='typescript_program'||typeof baseline.programName!=='string'||typeof baseline.summary!=='string'||!Array.isArray(baseline.files)||baseline.files.length>12||!Array.isArray(baseline.limitations)||baseline.limitations.some(v=>typeof v!=='string'))throw new Error('Invalid task files.');
 for(const f of baseline.files){const row=object(f);keys(row,['path','content']);if(typeof row.path!=='string'||typeof row.content!=='string')throw new Error('Invalid file.');}
 validateProgramCandidateStructure(baseline as ProgramCandidateProposal);
 const candidate=baseline as ProgramCandidateProposal,paths=new Set(candidate.files.map(f=>f.path));
 if(!candidate.files.some(f=>f.path.startsWith('tests/')))throw new Error('Frozen tests required.');
 for(const f of candidate.files)assertBoundedProgramSource(f.path,f.content,paths);
 if(!Array.isArray(x.proposals)||x.proposals.length<1||x.proposals.length>3)throw new Error('One to three proposals required.');
 for(const p of x.proposals){const row=object(p);keys(row,['path','before','content']);const file=candidate.files.find(f=>f.path===row.path);
  if(!file||!file.path.startsWith('src/')||file.path==='src/index.ts'||row.before!==sha256(file.content)||typeof row.content!=='string'||row.content===file.content)throw new Error('Repair must target a digest-bound existing source file.');
  assertBoundedProgramSource(file.path,row.content,paths);
 }
 return structuredClone(x) as TaskPackage;
}
let active=false;
export async function runTaskPackage(raw:unknown,constitutionDigest:string,beforeStage:(stage:string)=>Promise<void>){
 if(active)throw new Error('Task worker busy.');active=true;
 try{return await execute(raw,constitutionDigest,beforeStage);}finally{active=false;}
}
async function execute(raw:unknown,constitutionDigest:string,beforeStage:(stage:string)=>Promise<void>){
 const input=validateTaskPackage(raw),startedAt=new Date().toISOString();
 if(!/^[a-f0-9]{64}$/.test(constitutionDigest))throw new Error('Constitution digest required.');
 const result={version:'task-worker-v1',inputDigest:sha256(canonicalJson(input)),source:input.source,revision:input.revision,sourceIdentity:'owner_supplied_unverified',startedAt,
  status:'no_verified_candidate' as 'verified_isolated'|'no_failure'|'baseline_unqualified'|'no_verified_candidate',baseline:null as ProgramVerificationResult|null,
  attempts:[] as {proposalDigest:string;verification:ProgramVerificationResult}[],verification:null as ProgramVerificationResult|null,recheck:null as ProgramVerificationResult|null,candidate:null as ProgramCandidateProposal|null,
  submitted:false,sponsorAcceptance:'unknown',paymentReceived:'unknown',profit:'unknown',modelCalls:0,providerCashUsd:0,infrastructureAllocation:'unknown',
  limitations:['Supplied proposals; no autonomous code generation.','Isolated bounded TypeScript only; no dependency installation or full repository acceptance.','Source identity and sponsor eligibility are unverified. No submission authority.']};
 const verify=(candidate:ProgramCandidateProposal)=>verifyTask(candidate,input.objective,constitutionDigest);
 await beforeStage('baseline');result.baseline=await verifyTask(input.baseline,input.objective,constitutionDigest,true);
 if(result.baseline.passed){result.status='no_failure';return result;}
 if(!result.baseline.failures.length||result.baseline.failures.some(f=>f.kind!=='behavior')){result.status='baseline_unqualified';return result;}
 for(const [index,p] of input.proposals.entries()){
  await beforeStage(`proposal-${index+1}`);
  const candidate=structuredClone(input.baseline);candidate.files.find(f=>f.path===p.path)!.content=p.content;
  const verification=await verify(candidate);result.attempts.push({proposalDigest:sha256(canonicalJson(p)),verification});
  if(!verification.passed)continue;
  await beforeStage('recheck');const recheck=await verify(candidate);result.verification=verification;result.recheck=recheck;
  if(recheck.passed&&recheck.artifactDigest===verification.artifactDigest){result.candidate=candidate;result.status='verified_isolated';}
  return result;
 }
 return result;
}
