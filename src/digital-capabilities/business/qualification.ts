import type { Json } from '../schema.ts';
import type { CapabilityResult, EvidenceRecord, ExecutionContext, FrozenCase, Provenance } from '../types.ts';
import { sha256, canonicalJson } from '../../canonical.ts';
import { acceptanceScopeDigest, verifyAcceptance } from './operations.ts';
const hash=(x:unknown)=>sha256(canonicalJson(x));
const out=(r:{output:Json})=>r.output as Record<string,Json>;
export const businessContext:ExecutionContext={ownerAuthenticated:false,emergencyStopped:false,authorityContextDigest:'a'.repeat(64),constitutionDigest:'b'.repeat(64),mandateDigest:null,mandateId:null,evidence:[],currentIdentity:{},controls:[],policyDecision:{allowed:true,code:'READ',reason:'Bounded supplied analysis'},benchmark:async()=>({})};
export function proof(id:string,claim:string,subject:Record<string,string|null>,provenance:Provenance='ISOLATED'):EvidenceRecord{return {id,sourceId:`fixture:${id}`,contentDigest:hash(id),provenance,claimedProvenance:null,authoritySource:false,subject,capturedAt:'2026-09-12T12:00:00Z',claims:[claim],integrity:'KERNEL_RECEIPT',receiptId:`receipt:${id}`};}
export function receipt(id:string,capabilityId:string,output:Json):CapabilityResult{return {schemaVersion:1,requestId:id,status:'SUCCEEDED',capability:{id:capabilityId,version:'1.0.0',implementationDigest:'a'.repeat(64),contractDigest:'b'.repeat(64)},selectionReason:'Frozen isolated fixture',inputDigest:'c'.repeat(64),output,observed:[],inferred:[],unknowns:[],confidence:{level:'HIGH',basis:'Frozen isolated fixture'},evidence:[],authority:{required:'READ_ONLY',available:true,contextDigest:'d'.repeat(64),mandateDigest:null,authorizationTokenIssued:false},cost:{actualCashMicroUsd:0,modelApiMicroUsd:0,allocatedCashMicroUsd:0,modeledLaborMicroUsd:null,costBasis:'DETERMINISTIC_LOCAL_COMPUTATION_NO_EXTERNAL_CALL'},persistentChanges:[],subject:{},resultDigest:hash(id)};}
export const revision='a'.repeat(40);
export const acceptanceInput={jobId:'job1',serviceFamily:'content-update',originalRequest:'Update supplied content.',requiredCapabilityIds:['ci-failure-triage'],scope:['Update content'],exclusions:['New features'],criteria:[{id:'content',description:'Content matches approved scope',provenance:'ISOLATED',proofIds:['criterion']}],deliveredRevision:revision,deploymentId:null,deploymentSha:null,limitations:[]};
export function acceptedFixture(jobId='job1'){const input={...acceptanceInput,jobId};const p=proof('criterion','customer-criterion:content:PASS',{jobId,revision,scopeDigest:acceptanceScopeDigest(input),criterionId:'content'});const result=verifyAcceptance(input,{...businessContext,evidence:[p]});return {input,proof:p,result,receipt:receipt(jobId,'customer-acceptance-verifier',result.output)};}
const first=acceptedFixture(),second=acceptedFixture('job2');
const capability={id:'ci-failure-triage',contractDigest:'a'.repeat(64),qualifiedEnabled:true,procedureEvidenceDigests:['b'.repeat(64)]};
const scopeInput={request:'Update supplied content',repository:'owner/site',revision,changedAreas:[{path:'content/home.md',system:'CONTENT',reason:'Requested text change'}],requiredCapabilityIds:['ci-failure-triage'],exclusions:['New features'],dependencies:[],acceptanceCriteria:['Approved content'],requestedAction:'ANALYZE'};
const observation={id:'demand1',sourceId:'customer:1',statement:'Customer requested content maintenance',kind:'SUPPORT',provenance:'EXTERNAL_READ_ONLY',proofIds:['demand-proof']};
const demandProof=proof('demand-proof','market-demand:demand1:SUPPORT',{serviceId:'content-update',observationId:'demand1',statementDigest:hash(observation.statement),sourceId:'customer:1'},'EXTERNAL_READ_ONLY');
const need={id:'monitor',description:'Monitor content drift',customerValue:'Detect unexpected changes',provenance:'ISOLATED',proofIds:['need-proof']};
const needProof=proof('need-proof','customer-need:monitor',{jobId:'job1',revision,needId:'monitor',descriptionDigest:hash(need.description),valueDigest:hash(need.customerValue)});
const needsInput={jobId:'job1',revision,acceptanceReceiptId:first.receipt.resultDigest,needs:[need]};
const needsContext={priorCapabilityResults:[first.receipt],evidence:[needProof]};
const design={experimentId:'experiment',hypothesis:'Scoped maintenance has repeat demand',metric:'qualified inquiries',minimumThreshold:2,direction:'MAXIMIZE',costCeilingMicroUsd:1000,startedAt:'2026-09-13T00:00:00Z'};
export const experimentInput={phase:'REGISTER',design,registrationReceiptId:null,result:null,resultProvenance:'ISOLATED',proofIds:[]};
const productInput={serviceFamily:'content-update',acceptedJobReceiptIds:[first.receipt.resultDigest,second.receipt.resultDigest],requiredCapabilityIds:['ci-failure-triage'],intakeRequirements:['Authorized source revision'],humanOnlyBoundaries:['Customer commitments require exact authority']};
export const businessCases:Record<string,FrozenCase[]>={
 'website-maintenance-scope-estimator':[
 {name:'actual-qualified-capability-required',input:scopeInput,context:{serviceCapabilityEvidence:[capability]},check:r=>out(r).allCapabilitiesAvailable===true&&out(r).safeAutonomousExecutionAllowed===true},
 {name:'unknown-capability-blocks-execution',input:{...scopeInput,requiredCapabilityIds:['imaginary']},check:r=>out(r).allCapabilitiesAvailable===false&&out(r).safeAutonomousExecutionAllowed===false}],
 'market-demand-validator':[
 {name:'independent-demand-proof',input:{serviceId:'content-update',observations:[observation],inferences:[],speculation:[]},context:{evidence:[demandProof]},check:r=>out(r).status==='VALIDATED'},
 {name:'supplied-claims-are-not-demand-proof',input:{serviceId:'content-update',observations:[observation],inferences:['Might be repeatable'],speculation:['Maybe large market']},check:r=>out(r).status==='INSUFFICIENT_EVIDENCE'}],
 'competitive-offer-analyzer':[
 {name:'unknown-competitor-fields-remain-null',input:{offers:[{id:'competitor',sourceId:'public:offer',sourceUrl:'https://example.com/offer',priceMicro:null,currency:null,billingUnit:null,scope:['Content updates'],deliverables:[],turnaround:null,exclusions:[],guarantees:[],positioning:null,customerSegment:null}]},check:r=>(out(r).comparablePriceGroups as Json[]).length===0&&(out(r).comparisons as Record<string,Json>[])[0]!.priceMicro===null},
 {name:'empty-market-is-not-invented',input:{offers:[]},check:r=>(out(r).comparisons as Json[]).length===0&&out(r).externallyVerified===false}],
 'proposal-compiler':[
 {name:'unapproved-proposal-remains-incomplete-draft',input:{opportunityId:'opportunity',approvalReceiptId:null,problem:'Content is stale',scope:['Update content'],deliverables:['Reviewed revision'],exclusions:['Hosting'],acceptanceCriteria:['Approved content'],sequence:[],priceMicro:null,currency:null,paymentAssumptions:[],customerResponsibilities:['Supply source'],limitations:[]},check:r=>out(r).status==='INCOMPLETE_EVIDENCE'&&out(r).bindingOffer===false},
 {name:'owner-approval-does-not-authorize-sending',input:{opportunityId:'opportunity',approvalReceiptId:receipt('decision','decision-register',{}).resultDigest,problem:'Content is stale',scope:['Update content'],deliverables:['Reviewed revision'],exclusions:['Hosting'],acceptanceCriteria:['Approved content'],sequence:['Review source'],priceMicro:1000000,currency:'USD',paymentAssumptions:['Price subject to owner review'],customerResponsibilities:['Supply source'],limitations:[]},context:{priorCapabilityResults:[receipt('decision','decision-register',{authoritySource:'AUTHENTICATED_OWNER',record:{scope:'opportunity:opportunity',decision:'APPROVE_PROPOSAL_DRAFT'}})]},check:r=>out(r).status==='DRAFT'&&out(r).bindingOffer===false}],
 'customer-acceptance-verifier':[
 {name:'exact-scope-independent-proof',input:first.input,context:{evidence:[first.proof]},check:r=>out(r).status==='PASS'&&out(r).independentlyVerified===true},
 {name:'success-label-without-proof-does-not-pass',input:first.input,check:r=>out(r).status==='INCOMPLETE_EVIDENCE'&&out(r).independentlyVerified===false},
 {name:'stale-revision-does-not-pass',input:{...first.input,deliveredRevision:'b'.repeat(40)},context:{evidence:[first.proof]},check:r=>out(r).status==='INCOMPLETE_EVIDENCE'}],
 'delivery-evidence-pack-compiler':[
 {name:'actual-acceptance-receipt-produces-draft',input:{jobId:'job1',revision,acceptanceReceiptId:first.receipt.resultDigest,changes:['Updated content'],rollbackInformation:['Restore previous revision'],screenshotProofIds:[]},context:{priorCapabilityResults:[first.receipt]},check:r=>out(r).status==='DRAFT_READY'&&out(r).deliveryAuthorized===false},
 {name:'missing-acceptance-stays-missing',input:{jobId:'job1',revision,acceptanceReceiptId:first.receipt.resultDigest,changes:[],rollbackInformation:[],screenshotProofIds:[]},check:r=>out(r).status==='INCOMPLETE_EVIDENCE'&&out(r).originalRequest===null}],
 'upsell-opportunity-detector':[
 {name:'actual-adjacent-need-required',input:needsInput,context:needsContext,check:r=>out(r).status==='CANDIDATES'&&out(r).outreachAuthorized===false},
 {name:'unsupported-defect-is-not-an-upsell',input:needsInput,check:r=>(out(r).opportunities as Json[]).length===0}],
 'recurring-revenue-converter':[
 {name:'two-proven-needs-support-voluntary-candidate',input:{jobId:'job1',revision,observations:['o1','o2'].map(occurrenceId=>({occurrenceId,needId:'monitor',description:'Content drift recurred',customerValue:'Detect unexpected changes',provenance:'ISOLATED',proofIds:[occurrenceId]})),proposedCadence:'Monthly review',cancellationTerms:'Cancel at any time',customerOwnsData:true},context:{evidence:['o1','o2'].map(occurrenceId=>proof(occurrenceId,'recurring-need:monitor',{jobId:'job1',revision,occurrenceId,needId:'monitor',descriptionDigest:hash('Content drift recurred'),valueDigest:hash('Detect unexpected changes')}))},check:r=>out(r).status==='CANDIDATE'&&out(r).advertisementAuthorized===false},
 {name:'lock-in-boundary',input:{jobId:'job1',revision,observations:[],proposedCadence:null,cancellationTerms:'',customerOwnsData:false},check:r=>out(r).status==='BLOCKED'}],
 'customer-retention-planner':[
 {name:'helpful-follow-up-remains-draft',input:needsInput,context:needsContext,check:r=>out(r).status==='DRAFT'&&out(r).outreachAuthorized===false},
 {name:'no-invented-retention-needs',input:{...needsInput,needs:[]},check:r=>(out(r).actions as Json[]).length===0}],
 'business-experiment-evaluator':[
 {name:'design-fixed-before-results',input:experimentInput,check:r=>out(r).status==='DESIGN_RECORDED'&&out(r).actualRevenueMicroUsd===null},
 {name:'unregistered-results-are-not-verified',input:{...experimentInput,phase:'EVALUATE',result:{metricValue:100,actualCashCostMicroUsd:0,actualRevenueMicroUsd:0,predictedRevenueMicroUsd:1000000}},check:r=>out(r).status==='INCOMPLETE_EVIDENCE'&&out(r).actualRevenueMicroUsd===null&&out(r).predictedRevenueMicroUsd===1000000}],
 'repeatable-service-productizer':[
 {name:'distinct-verified-jobs-and-current-capabilities',input:productInput,context:{priorCapabilityResults:[first.receipt,second.receipt],serviceCapabilityEvidence:[capability]},check:r=>out(r).status==='CANDIDATE'&&(out(r).verifiedJobIds as Json[]).length===2&&out(r).priceBand===null},
 {name:'caller-success-claims-cannot-create-service',input:productInput,check:r=>out(r).status==='INSUFFICIENT_EVIDENCE'&&(out(r).verifiedJobIds as Json[]).length===0}],
};
