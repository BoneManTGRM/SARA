import type {Capability,LedgerEntry,ActionRequest,PolicyDecision} from './types.ts';
import type {StandingMandate,AutonomyDecision} from './autonomy.ts';
import type {RevenuePilotJob} from './revenue-pilot.ts';
import type {RevenuePaymentIntent} from './revenue-payment.ts';
import type {StoredEvent} from './store.ts';
export type RevenueEligibilityState={emergencyStopped:boolean;capabilities:Capability[];ledger:LedgerEntry[];revenuePaymentIntents:RevenuePaymentIntent[];standingMandate:StandingMandate|null;events:StoredEvent[]};
/** Revalidate an already admitted job; this never creates a new approval,
 * consumes a fresh mandate action, or changes the commercial obligation. */
export function revenueStepBlocker(state:RevenueEligibilityState,job:RevenuePilotJob,now=new Date()):string|null{
 if(state.emergencyStopped)return 'Emergency stop blocks the next paid step.';
 const missing=job.plan.requiredCapabilities.filter(id=>!state.capabilities.some(c=>c.id===id&&c.status==='available'));
 if(missing.length)return `Required capability unavailable: ${missing.join(', ')}.`;
 const revenue=state.ledger.find(e=>e.id===job.revenueEvidenceId);
 if(!revenue||revenue.kind!=='revenue'||revenue.source!=='customer'||!revenue.realized||revenue.amountUsd<job.plan.priceUsd)return 'Exact funded job revenue is unavailable.';
 if(state.ledger.some(e=>e.jobAccounting?.jobId===job.id&&e.jobAccounting.category==='REFUND'&&e.realized&&e.amountUsd>0))return 'Recorded payment refund requires obligation reconciliation.';
 const intents=state.revenuePaymentIntents.filter(i=>i.jobId===job.id);
 if(intents.length&&(intents.length!==1||intents[0]!.status!=='authorized'||!intents[0]!.payment||intents[0]!.revenueEvidenceId!==revenue.id||intents[0]!.amountUsd!==job.plan.priceUsd))return 'Exact authorized payment state changed; preserve and reconcile the obligation.';
 const admitted=state.events.find(e=>e.type==='revenue_pilot_snapshot'&&(e.data as RevenuePilotJob).id===job.id&&(e.data as RevenuePilotJob).revenueEvidenceId===revenue.id);
 if(!admitted)return 'Original paid job authority evidence is unavailable.';
 const history=state.events.filter(e=>e.sequence<admitted.sequence);
 if(admitted.actor.kind==='owner'&&admitted.actor.authenticated){
  const target=`revenue-pilot:${job.id}:fulfillment`;
  const approval=history.find(e=>{if(e.type!=='policy_decision'||e.actor.kind!=='owner'||e.actor.id!==admitted.actor.id||!e.actor.authenticated)return false;const d=e.data as {request:ActionRequest;decision:PolicyDecision};return d.decision.allowed&&d.request.action==='contract_commitment'&&d.request.targetId===target&&d.request.approval?.targetId===target&&d.request.approval.ownerId===admitted.actor.id;});
  return approval?null:'Exact original owner fulfillment approval is unavailable.';
 }
 const intent=intents[0];
 const decision=history.find(e=>e.type==='autonomy_decision'&&(e.data as AutonomyDecision).requestId===`fixed-service-fulfillment:${intent?.id}`&&(e.data as AutonomyDecision).outcome==='automatic');
 if(!decision)return 'Original paid mandate decision is unavailable.';
 return mandateContinuationBlocker(state,decision,job,now);
}
export function mandateContinuationBlocker(state:Pick<RevenueEligibilityState,'standingMandate'|'events'|'emergencyStopped'>,decision:StoredEvent,job:RevenuePilotJob,now=new Date()):string|null{
 const d=decision.data as AutonomyDecision,m=state.standingMandate;
 const original=state.events.filter(e=>e.sequence<decision.sequence&&e.type==='standing_mandate_snapshot'&&(e.data as StandingMandate).id===d.mandateId).at(-1)?.data as StandingMandate|undefined;
 if(state.emergencyStopped)return 'Emergency stop blocks paid mandate continuation.';
 if(!m||!original||m.id!==d.mandateId||m.digest!==original.digest||m.revokedAt||now.getTime()<Date.parse(m.startsAt)||now.getTime()>=Date.parse(m.expiresAt)||!m.allowedActions.includes('fixed_service_fulfillment')||!m.allowedChannels.includes('approved_api')||!m.allowedServiceIds.includes(job.plan.serviceId)||m.maximumCostPerActionUsd<job.plan.maximumExecutionCostUsd)return 'The original paid fulfillment mandate is revoked, expired, changed or out of scope.';
 return null;
}
