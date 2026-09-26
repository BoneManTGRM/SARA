import {canonicalJson,sha256} from './canonical.ts';
import {projectId,timestamp,type Project,type EvidenceMemory,type Stage} from './second-brain.ts';
import type {MemoryRecord} from './types.ts';
export const GITHUB_PROJECTS:Record<Project,string>={nico:'BoneManTGRM/NICO',sara:'BoneManTGRM/SARA','nicos-world':'BoneManTGRM/Nicos-Adventures'};
export type GitHubImportInput={kind:'commit';sha:string}|{kind:'pr';number:number}|{kind:'workflow';runId:number;attempt:number};
export type GitHubImportResult={records:Omit<EvidenceMemory,'id'>[];status:'complete'|'failed';errors:string[];coverage:{requested:1;imported:number;scope:string;pagination:'not_requested'};checkedAt:string};
type Options={fetch?:typeof fetch;now?:string;signal?:AbortSignal;timeoutMs?:number};
let active=0;
const sha=(v:unknown):string=>{if(typeof v!=='string'||!/^[a-f0-9]{40}$/.test(v))throw new Error('Invalid source revision.');return v;};
const integer=(v:unknown):number=>{if(!Number.isSafeInteger(v)||Number(v)<1)throw new Error('Invalid positive identifier.');return Number(v);};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid source object.');return v as Record<string,unknown>;};
function reportedExcerpt(value:unknown,limit:number) {
 if(value===null||value===undefined)return null;
 if(typeof value!=='string')throw new Error('Invalid source text.');
 let end=Math.min(value.length,limit);
 if(end<value.length&&/[\uDC00-\uDFFF]/.test(value.charAt(end)))end--;
 return {text:value.slice(0,end),originalLength:value.length,truncated:end<value.length,fullContentDigest:sha256(value),offsetUnit:'utf16_code_units'};
}
function sourceTime(v:unknown,now:string):string {const t=timestamp(v);if(!t||Date.parse(t)>Date.parse(now)+60_000)throw new Error('Invalid source observation time.');return t;}
function publicRepo(v:unknown,expected:string){const r=object(v);if(r.private!==false||r.full_name!==expected)throw new Error('Public project repository identity was not verified.');}
/** Link only the exact older metadata-only shape of the SAME observation.
 * Existing prose, changed outcomes and different source times are not enrichment. */
export function githubContextPredecessors(memories:readonly MemoryRecord[],next:Omit<EvidenceMemory,'id'>):string[] {
 const stable=(e:EvidenceMemory['projectEvidence'])=>{const {contentDigest,ingestedAt,lastVerifiedAt,expiresAt,...identity}=e;return identity;};
 return memories.filter(previous=>{
  const e=previous.projectEvidence;
  if(!e||previous.scope!==next.scope||previous.source!==next.source||e.verification!=='source_observed'||e.dataClass!=='public'||
    !previous.tags?.includes('github-public-observation')||sha256(previous.statement)!==e.contentDigest||
    canonicalJson(stable(e))!==canonicalJson(stable(next.projectEvidence)))return false;
  try {
   const before=object(JSON.parse(previous.statement)),after=object(JSON.parse(next.statement));
   if(Object.hasOwn(before,'reportedContent')||!Object.hasOwn(after,'reportedContent'))return false;
   const {reportedContent,...metadata}=after;
   return canonicalJson(before)===canonicalJson(metadata);
  }catch{return false;}
 }).map(m=>m.id).sort();
}
/** Caller must authenticate owner and check read/import authority before invoking. No credentials or arbitrary URL accepted. */
export async function importGitHubEvidence(project:Project,input:GitHubImportInput,options:Options={}):Promise<GitHubImportResult>{
 projectId(project);const value=object(input),kind=value.kind;
 const keys=kind==='commit'?['kind','sha']:kind==='pr'?['kind','number']:kind==='workflow'?['kind','runId','attempt']:[];
 if(!keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw new Error('Unsupported import fields.');
 const repository=GITHUB_PROJECTS[project],path=kind==='commit'?`commits/${sha(value.sha)}`:kind==='pr'?`pulls/${integer(value.number)}`:`actions/runs/${integer(value.runId)}/attempts/${integer(value.attempt)}`;
 const now=timestamp(options.now??new Date().toISOString())!;
 if(!now)throw new Error('Invalid ingestion timestamp.');
 const result:GitHubImportResult={records:[],status:'failed',errors:[],checkedAt:now,coverage:{requested:1,imported:0,scope:'one requested object; excludes jobs, checks, artifacts, files and deployments',pagination:'not_requested'}};
 if(active>=2){result.errors=['Import concurrency limit reached; retry manually.'];return result;}
 active++;
 const controller=new AbortController();const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});
 if(options.signal?.aborted)controller.abort();
 const timeout=Math.min(10000,Math.max(1,options.timeoutMs??10000));let timer:ReturnType<typeof setTimeout>|undefined;
 const expired=new Promise<never>((_,reject)=>{const fail=()=>reject(new Error('Import deadline or cancellation.'));controller.signal.addEventListener('abort',fail,{once:true});if(controller.signal.aborted)fail();timer=setTimeout(()=>controller.abort(),timeout);});
 let bytes=0;
 async function get(suffix:string){
  if(controller.signal.aborted)throw new Error('Import cancelled.');
  const response=await (options.fetch??fetch)(`https://api.github.com/repos/${repository}${suffix}`,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:controller.signal});
  if(!response.ok){await response.body?.cancel();throw new Error(`GitHub HTTP ${response.status}; no evidence imported.`);}
  if(Number(response.headers.get('content-length')??0)>262144){await response.body?.cancel();throw new Error('Import byte bound exceeded.');}
  if(!response.body)throw new Error('Empty source response.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let body='';
  try{for(;;){if(controller.signal.aborted)throw new Error('Import cancelled.');const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>262144)throw new Error('Import byte bound exceeded.');body+=decoder.decode(part.value,{stream:true});}body+=decoder.decode();return object(JSON.parse(body));}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 async function acquire(){
  publicRepo(await get(''),repository);
  const data=await get('/'+path);let revision:string,observedAt:string,stage:Stage|null=null,outcome:string,source:string,pr:number|null=null,runId:number|null=null,runAttempt:number|null=null;
  let payload:Record<string,unknown>;
  if(kind==='commit'){
   revision=sha(data.sha);if(revision!==value.sha)throw new Error('Source SHA mismatch.');const commit=object(data.commit);observedAt=sourceTime(object(commit.committer).date,now);stage='committed';outcome='success';source=`https://github.com/${repository}/commit/${revision}`;
   payload={kind,repository,revision,committedAt:observedAt,reportedContent:{verification:'reported',message:reportedExcerpt(commit.message,4096)}};
  }else if(kind==='pr'){
   pr=integer(data.number);if(pr!==value.number)throw new Error('Source PR mismatch.');publicRepo(object(data.base).repo,repository);
   const head=sha(object(data.head).sha);if(!['open','closed'].includes(String(data.state))||typeof data.merged!=='boolean')throw new Error('Invalid PR state.');
   observedAt=sourceTime(data.updated_at,now);revision=data.merged?sha(data.merge_commit_sha):head;
   if(data.merged){if(data.state!=='closed')throw new Error('Inconsistent PR state.');sourceTime(data.merged_at,now);stage='merged';outcome='success';}else outcome=String(data.state);
   source=`https://github.com/${repository}/pull/${pr}`;payload={kind,repository,pr,headRevision:head,mergeRevision:data.merged?revision:null,state:data.state,merged:data.merged,mergedAt:data.merged?data.merged_at:null,updatedAt:observedAt,reportedContent:{verification:'reported',title:reportedExcerpt(data.title,512),body:reportedExcerpt(data.body,4096)}};
  }else{
   runId=integer(data.id);runAttempt=integer(data.run_attempt);if(runId!==value.runId||runAttempt!==value.attempt)throw new Error('Source workflow attempt mismatch.');publicRepo(data.repository,repository);
   revision=sha(data.head_sha);observedAt=sourceTime(data.updated_at,now);
   if(!['queued','in_progress','completed','waiting','requested','pending'].includes(String(data.status)))throw new Error('Invalid workflow status.');
   const conclusions=['success','failure','neutral','cancelled','skipped','timed_out','action_required','stale','startup_failure'];
   if(data.conclusion!==null&&!conclusions.includes(String(data.conclusion)))throw new Error('Invalid workflow conclusion.');
   if((data.status==='completed')!==(data.conclusion!==null))throw new Error('Inconsistent workflow completion.');
   outcome=data.conclusion===null?String(data.status):String(data.conclusion);source=`https://github.com/${repository}/actions/runs/${runId}/attempts/${runAttempt}`;
   payload={kind,repository,revision,runId,runAttempt,status:data.status,conclusion:data.conclusion,updatedAt:observedAt,reportedContent:{verification:'reported',name:reportedExcerpt(data.name,512),title:reportedExcerpt(data.display_title,512)},acceptance:'No test, merge, deployment or production requirement established by this workflow observation.'};
  }
  const statement=canonicalJson(payload);
  const record:Omit<EvidenceMemory,'id'>={category:'working',statement,source,scope:project,observedAt,lastValidatedAt:'',confidence:0,verification:'measured',dependencies:[],status:'active',supersedes:[],tags:['second-brain','github-public-observation'],projectEvidence:{schemaVersion:1,project,kind:'source',verification:'source_observed',dataClass:'public',contentDigest:sha256(statement),ingestedAt:now,observedAt,lastVerifiedAt:now,expiresAt:new Date(Date.parse(now)+86400000).toISOString(),stage,outcome,repository,revision,pr,runId,runAttempt,artifactId:null,deploymentId:null,environment:null,claimKey:`github:${repository}:${path}`,conflictsWith:[]}};
  return record;
 }
 try{const record=await Promise.race([acquire(),expired]);result.records=[record];result.status='complete';result.coverage.imported=1;}
 catch(error){result.errors=[error instanceof Error&&/^(GitHub HTTP|Import |Invalid |Source |Public |Inconsistent |Empty )/.test(error.message)?error.message:'Source retrieval or schema validation failed; no evidence imported.'];}
 finally{controller.abort();if(timer)clearTimeout(timer);options.signal?.removeEventListener('abort',abort);active--;}
 return result;
}
