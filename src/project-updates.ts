import {GITHUB_PROJECTS,type GitHubImportInput} from './second-brain-github.ts';
import {projectId,type Project} from './second-brain.ts';
export const PROJECT_REFRESH_INTERVAL_MS=15*60*1000;
export const UPDATE_COVERAGE='Partial snapshot: latest default-branch commit, most recently updated PR, newest workflow run. No pagination, all-PR coverage, jobs, artifacts or deployment checks.';
/** Fixed public repository discovery only. Detail imports revalidate every identity. */
export async function discoverProjectUpdates(project:Project,options:{fetch?:typeof fetch;timeoutMs?:number}={}){
 const repository=GITHUB_PROJECTS[projectId(project)];
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const targets:GitHubImportInput[]=[];
 let bytes=0;
 const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('schema');return v as Record<string,unknown>;};
 const integer=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<1)throw new Error('identifier');return Number(v);};
 const first=(v:unknown)=>{if(!Array.isArray(v)||v.length>1)throw new Error('list');return v.length?object(v[0]):null;};
 async function get(path:string):Promise<unknown>{
  if(controller.signal.aborted)throw new Error('deadline');
  const response=await (options.fetch??fetch)(`https://api.github.com/repos/${repository}${path}`,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:controller.signal});
  if(!response.ok||Number(response.headers.get('content-length')??0)>262144){await response.body?.cancel();throw new Error('source');}
  const reader=response.body?.getReader();if(!reader)throw new Error('empty');const chunks:Uint8Array[]=[];
  try{for(;;){if(controller.signal.aborted)throw new Error('deadline');const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>262144)throw new Error('size');chunks.push(part.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  finally{void reader.cancel().catch(()=>{});}
 }
 async function acquire(){
  const repo=object(await get(''));if(repo.private!==false||repo.full_name!==repository)throw new Error('identity');
  const commit=first(await get('/commits?per_page=1'));if(commit){if(typeof commit.sha!=='string'||!/^[a-f0-9]{40}$/.test(commit.sha))throw new Error('revision');targets.push({kind:'commit',sha:commit.sha});}
  const pr=first(await get('/pulls?state=all&sort=updated&direction=desc&per_page=1'));if(pr)targets.push({kind:'pr',number:integer(pr.number)});
  const run=first(object(await get('/actions/runs?per_page=1')).workflow_runs);if(run)targets.push({kind:'workflow',runId:integer(run.id),attempt:integer(run.run_attempt)});
 }
 try{await Promise.race([acquire(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('deadline'));},Math.max(1,Math.min(10000,options.timeoutMs??10000)));})]);return {status:'complete' as const,targets,coverage:UPDATE_COVERAGE};}
 catch{return {status:'failed' as const,targets:[] as GitHubImportInput[],coverage:UPDATE_COVERAGE};}
 finally{controller.abort();if(timer)clearTimeout(timer);}
}
