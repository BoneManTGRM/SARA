import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaraKernel,SARA_PRINCIPAL} from '../../src/kernel.ts';
import {compileLearningCampaign,learningContractDigest} from '../../src/learning-campaign.ts';
import {canonicalJson,sha256} from '../../src/canonical.ts';
import type {Job} from '../../src/types.ts';

/** Only a newly allocated isolated test directory can receive this legacy fixture.
 * No application route, production path or public event-store writer is added. */
export async function legacyLearningRetryFixture(options:{failedRoots?:2|3;concurrentRoot?:boolean}={}){
 const directory=await mkdtemp(join(tmpdir(),'sara-retry-fixture-'));
 const token='synthetic-retry-fixture-owner';
 let kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
 try{
  const owner=kernel.authenticateOwnerToken(token),now=new Date();
  const campaign={id:'legacy-retry-campaign',maximumRequests:10,contracts:[{capabilityId:'legacy-retry-skill',objective:'Preserve the supplied value',publicCriteria:['Return the supplied value'],estimatedEffort:1,acceptanceTests:[{name:'one',input:1,expected:1},{name:'two',input:2,expected:2}]}]};
  const compiled=compileLearningCampaign(campaign);
  await kernel.configureLearningCampaign(owner,campaign,compiled.digest);
  await kernel.activateStandingMandate(owner,{id:'legacy-retry-mandate',ownerId:owner.id,allowedActions:['business_candidate_development'],allowedChannels:['internal'],allowedServiceIds:['skill-learning'],maximumCostPerActionUsd:0,maximumDailyActions:20,maximumConcurrentActions:1,startsAt:new Date(now.getTime()-60000).toISOString(),expiresAt:new Date(now.getTime()+86400000).toISOString()},
   {approvalId:'legacy-retry-approval',ownerId:owner.id,action:'required_owner_approval_change',targetId:'standing-mandate:legacy-retry-mandate',approvedAt:now.toISOString()});
  const source=await kernel.createSelfDevelopmentJob(owner,{objective:'Preserve the supplied value',expectedOwnerValue:1,requiredCapabilities:['legacy-retry-skill'],acceptanceCriteria:['Return the supplied value'],maximumBudgetUsd:0});
  const events=await kernel.inspectAudit();
  const failedRoots=options.failedRoots??3;
  const jobs:Job[]=[...Array.from({length:failedRoots},(_,i)=>`failed-root-${i+1}`),'legacy-authorized-root',...(options.concurrentRoot?['zz-concurrent-root']:[])].map((id,index)=>({id,kind:'self_development',status:index<failedRoots?'failed':'authorized',learningCampaignId:compiled.id,learningCapabilityId:'legacy-retry-skill',learningContractDigest:learningContractDigest(compiled.contracts[0]!),learningSourceJobId:source.id,workCard:{...source.workCard,id:`card-${id}`,requiredCapabilities:['autonomous-learning'],missingCapabilities:[]}}));
  for(const job of jobs){const event={id:`fixture-event-${job.id}`,sequence:events.length+1,occurredAt:now.toISOString(),type:'job_created',actor:SARA_PRINCIPAL,data:job,previousHash:events.at(-1)!.hash};events.push({...event,hash:sha256(canonicalJson(event))});}
  const mandate=events.filter(e=>e.type==='standing_mandate_snapshot').at(-1)!.data as {digest:string};
  for(const job of jobs.filter(j=>j.status==='failed'||j.id==='zz-concurrent-root')){const event={id:`fixture-reservation-${job.id}`,sequence:events.length+1,occurredAt:now.toISOString(),type:'autonomous_learning_reserved',actor:SARA_PRINCIPAL,data:{jobId:job.id,campaignId:compiled.id,contractDigest:job.learningContractDigest,mandateDigest:mandate.digest},previousHash:events.at(-1)!.hash};events.push({...event,hash:sha256(canonicalJson(event))});}
  // Emulate a copied pre-guard snapshot, then require normal boot hash validation.
  await writeFile(join(directory,'events.ndjson'),events.map(e=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600});
  kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token)});
  return {kernel,directory,token,jobs,cleanup:()=>rm(directory,{recursive:true,force:true})};
 }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
