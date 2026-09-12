import { extractNicoArtifactIdentity,type NicoOperator } from '../../nico-operator.ts';
import { snapshotJson,type Json } from '../schema.ts';
import type { EvidenceRecord,ExecutionContext,ExecutionOutput } from '../types.ts';
import { digest,type Data } from '../engineering/common.ts';
import { subject } from './common.ts';
export type NicoReleaseIdentity={deploymentSha:string;deploymentId:string};
export type NicoReadObserver={environment:'PRODUCTION'|'ISOLATED';timeoutMs:number;getRun:(runId:string)=>Promise<Record<string,unknown>>;releaseIdentity:(run:Record<string,unknown>)=>NicoReleaseIdentity|null;sourceUrl?:(runId:string)=>string};
export type NicoObservationContext=ExecutionContext&{nicoObserver?:NicoReadObserver};
const object=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** One existing fixed-route GET. Deployment identity is extracted from that same response, never from a caller label or a different read. */
export function createNicoReadObserver(operator:Pick<NicoOperator,'getRun'>,options:{environment:'PRODUCTION'|'ISOLATED';timeoutMs?:number;isolatedSourceBaseUrl?:string}):NicoReadObserver {
 if(!['PRODUCTION','ISOLATED'].includes(options.environment))throw new Error('NICO_OBSERVER_ENVIRONMENT_REQUIRED');
 const timeoutMs=options.timeoutMs??10000;if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('NICO_OBSERVER_TIMEOUT_BOUNDS');
 let isolatedBase:URL|null=null;if(options.isolatedSourceBaseUrl){isolatedBase=new URL(options.isolatedSourceBaseUrl);if(options.environment!=='ISOLATED'||isolatedBase.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(isolatedBase.hostname)||isolatedBase.username||isolatedBase.password||isolatedBase.search||isolatedBase.hash)throw new Error('NICO_ISOLATED_SOURCE_BOUNDARY');}
 return {environment:options.environment,timeoutMs,sourceUrl:id=>options.environment==='PRODUCTION'?`https://app.nicoaudit.com/api/nico/assessment/comprehensive-run/${id}`:isolatedBase?new URL(`/api/nico/assessment/comprehensive-run/${id}`,isolatedBase).toString():`isolated:nico-operator/${id}`,getRun:id=>operator.getRun(id),releaseIdentity:run=>{
  const reports=object(run.reports),report=object(reports?.json),assessment=object(report?.assessment);
  const release=object(run.nico_release_provenance)??object(run.release_provenance)??object(assessment?.nico_release_provenance);
  if(!release||release.artifact_schema!=='nico.comprehensive_release_provenance.v1'||release.deployment_identity_established!==true||release.deployment_identity_conflict!==false||release.backend_identity_source!=='RAILWAY_GIT_COMMIT_SHA'||typeof release.backend_build_commit!=='string'||!/^[a-f0-9]{40}$/.test(release.backend_build_commit)||typeof release.railway_deployment_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(release.railway_deployment_id))return null;
  return {deploymentSha:release.backend_build_commit,deploymentId:release.railway_deployment_id};
 }};
}
export async function productionProof(input:Data,context:ExecutionContext):Promise<ExecutionOutput&{capturedEvidence?:readonly EvidenceRecord[]}> {
 const observer=(context as NicoObservationContext).nicoObserver;const identity=input.identity as Data;
 const base={provenance:'NONE',sourceUrl:null,deploymentSha:null,deploymentId:null,runIdentityMatched:false,artifactIdentityMatched:false,responseDigest:null,readRequests:0,externalMutations:0};
 if(!observer)return{output:{...base,status:'BLOCKED',reasons:['NICO_READ_OBSERVER_NOT_CONFIGURED']},status:'BLOCKED',unknowns:['No NICO runtime request was performed.']};
 const sourceUrl=observer.sourceUrl?.(String(identity.runId))??(observer.environment==='PRODUCTION'?`https://app.nicoaudit.com/api/nico/assessment/comprehensive-run/${String(identity.runId)}`:`isolated:nico-operator/${String(identity.runId)}`);let timeout:ReturnType<typeof setTimeout>|undefined;
 let raw:Record<string,unknown>;
 try{raw=await Promise.race([observer.getRun(String(identity.runId)),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('NICO_OBSERVATION_TIMEOUT')),observer.timeoutMs);})]);}
 catch(error){const message=error instanceof Error?error.message:'';return{output:{...base,sourceUrl,readRequests:1,status:'BLOCKED',reasons:[message==='NICO_OBSERVATION_TIMEOUT'?'NICO_READ_TIMEOUT':/\b(?:401|403)\b/.test(message)?'NICO_READ_PERMISSION_DENIED':'NICO_READ_FAILED']},status:'BLOCKED',unknowns:['No production behavior was established. Retry requires fresh failure classification.']};}
 finally{if(timeout!==undefined)clearTimeout(timeout);}
 let run:Record<string,unknown>;
 try{const value=snapshotJson(raw,196608);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('OBJECT_REQUIRED');run=value as Record<string,unknown>;}catch{return{output:{...base,sourceUrl,readRequests:1,status:'BLOCKED',reasons:['NICO_RESPONSE_INVALID_OR_OVERSIZE']},status:'BLOCKED'};}
 const responseDigest=digest(run);const matched=run.run_id===identity.runId&&run.repository===identity.repository&&run.commit_sha===identity.commitSha;
 let artifactMatched=false;try{const artifact=extractNicoArtifactIdentity(run,String(identity.runId));artifactMatched=artifact!==null&&artifact.revision===identity.revision&&artifact.report_artifact_digest===identity.reportDigest;}catch{artifactMatched=false;}
 const release=observer.releaseIdentity(run);const releaseMatches=release&&(input.expectedDeploymentSha===null||input.expectedDeploymentSha===release.deploymentSha)&&(input.expectedDeploymentId===null||input.expectedDeploymentId===release.deploymentId);
 const reasons:string[]=[];if(!matched)reasons.push('EXACT_RUN_REPOSITORY_OR_COMMIT_MISMATCH');if(!artifactMatched)reasons.push('EXACT_REPORT_ARTIFACT_MISMATCH');if(!release)reasons.push('DEPLOYMENT_IDENTITY_NOT_PRESENT_IN_CAPTURE');else if(!releaseMatches)reasons.push('DEPLOYMENT_IDENTITY_MISMATCH');
 const status=matched&&artifactMatched&&releaseMatches?(observer.environment==='PRODUCTION'?'PRODUCTION_IDENTITY_OBSERVED':'ISOLATED_IDENTITY_OBSERVED'):'INCOMPLETE_EVIDENCE';
 const provenance=observer.environment==='ISOLATED'?'ISOLATED':releaseMatches?'PRODUCTION':'EXTERNAL_READ_ONLY';
 const captureSubject={...subject(identity),...(releaseMatches?{deploymentSha:release!.deploymentSha,deploymentId:release!.deploymentId}:{})};
 const capture:EvidenceRecord={id:digest({sourceUrl,responseDigest,subject:captureSubject,environment:observer.environment}),sourceId:sourceUrl,contentDigest:responseDigest,provenance,claimedProvenance:null,authoritySource:false,subject:captureSubject,capturedAt:new Date().toISOString(),claims:['nico-run-identity-observed',...(artifactMatched?['nico-report-identity-observed']:[])],integrity:'KERNEL_RECEIPT',receiptId:null};
 return{output:{...base,status,provenance,sourceUrl,deploymentSha:release?.deploymentSha??null,deploymentId:release?.deploymentId??null,runIdentityMatched:matched,artifactIdentityMatched:artifactMatched,responseDigest,readRequests:1,reasons},...(matched&&artifactMatched?{capturedEvidence:[capture]}:{}),observed:[{basis:'ACTUAL_NICO_GET_RUN',sourceUrl,responseDigest,provenance,exactIdentityMatched:matched&&artifactMatched}],unknowns:['Run readability and identity do not prove scanner completeness, specialist review, QC, approval or protected delivery. No consequential NICO endpoint was invoked.'],confidence:{level:status==='INCOMPLETE_EVIDENCE'?'LOW':'HIGH',basis:'Actual bounded read through the existing authorized adapter; claims are restricted to exact fields in this response.'}};
}
