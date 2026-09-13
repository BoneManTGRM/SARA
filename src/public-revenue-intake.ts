import {canonicalJson,sha256} from './canonical.ts';
import type {CommercialTerms} from './commercial-terms.ts';
import {createRevenuePaymentIntent,type RevenuePaymentIntent} from './revenue-payment.ts';
import {createRevenuePilotJob,type RevenuePilotInput,type RevenuePilotJob} from './revenue-pilot.ts';
import type {Capability} from './types.ts';

export type PublicRevenueIntakeInput={
 repository:string;
 recentCommitDays:number;
 primaryGoal:RevenuePilotInput['primaryGoal'];
 clientSecretDigest:string;
 customerReferenceDigest:string;
 recipientAddress:string;
 terms:CommercialTerms;
};

/** Compile within the kernel's existing serialized mutation. No plaintext
 * credentials, secondary store, payment evidence or fulfillment authority. */
export function compilePublicRevenueIntake(state:{revenuePilotJobs:RevenuePilotJob[];revenuePaymentIntents:RevenuePaymentIntent[];capabilities:Capability[]},input:PublicRevenueIntakeInput,now=new Date()){
 if(!/^[a-f0-9]{64}$/u.test(input.clientSecretDigest)||!/^[a-f0-9]{64}$/u.test(input.customerReferenceDigest))throw new Error('Checkout references must be SHA-256 digests.');
 const prefix=`inbound-${input.clientSecretDigest}-`;
 const scope=sha256(canonicalJson({repository:input.repository,primaryGoal:input.primaryGoal,customerReferenceDigest:input.customerReferenceDigest,termsDigest:input.terms.digest,recipientAddress:input.recipientAddress.toLowerCase(),serviceId:'public-repository-readiness-snapshot'}));
 const opportunityId=`${prefix}${scope.slice(0,48)}`;
 const existingJob=state.revenuePilotJobs.find(j=>j.plan.opportunityId.startsWith(prefix));
 if(existingJob&&existingJob.plan.opportunityId!==opportunityId)throw new Error('Checkout recovery secret is bound to a different scope.');
 const id=`pay_${input.clientSecretDigest}`;
 const existingIntent=state.revenuePaymentIntents.find(p=>p.id===id);
 if(existingIntent){
  if(!existingJob||existingIntent.jobId!==existingJob.id||existingIntent.clientSecretDigest!==input.clientSecretDigest||existingIntent.customerReferenceDigest!==input.customerReferenceDigest||existingIntent.termsDigest!==input.terms.digest||existingIntent.recipientAddress!==input.recipientAddress.toLowerCase())throw new Error('Checkout identity changed; reconcile the existing payment intent.');
  return {job:structuredClone(existingJob),intent:structuredClone(existingIntent),persistJob:false,persistIntent:false};
 }
 // Check capacity before creating any durable job. Concurrent requests enter
 // this compiler through the same existing kernel mutation queue.
 if(state.revenuePilotJobs.some(j=>j.id!==existingJob?.id&&j.revenueEvidenceId!==null&&['queued','running','owner_review','delivery_ready'].includes(j.status)))throw new Error('The one-job commercial lane is still fulfilling another paid job.');
 if(state.revenuePaymentIntents.some(p=>p.jobId!==existingJob?.id&&(p.status==='confirmed'||(p.status==='awaiting_payment'&&Date.parse(p.expiresAt)>=now.getTime()))))throw new Error('The one-job commercial lane already has an active payment intent.');
 const available=state.capabilities.filter(c=>c.status==='available').map(c=>c.id);
 const job=existingJob??createRevenuePilotJob({opportunityId,sourceUrl:input.repository,sourceAllowsAutomatedDiscovery:true,discoveredFromPublicSource:true,repoUrl:input.repository,repositoryIsPublic:true,repositoryOwnerPermissionConfirmed:true,requiresPrivateAccess:false,containsRegulatedOrPrivateData:false,requestsProductionChanges:false,requestsExploitValidation:false,primaryGoal:input.primaryGoal,customerBudgetUsd:149,desiredTurnaroundDays:3,recentCommitDays:input.recentCommitDays,requestedServiceId:'public-repository-readiness-snapshot'},available,now);
 if(job.plan.requiredCapabilities.some(id=>!available.includes(id)))throw new Error('Current service capabilities are unavailable; checkout remains blocked.');
 const intent=createRevenuePaymentIntent({id,job,recipientAddress:input.recipientAddress,clientSecretDigest:input.clientSecretDigest,customerReferenceDigest:input.customerReferenceDigest,terms:input.terms,now});
 return {job:structuredClone(job),intent,persistJob:!existingJob,persistIntent:true};
}
