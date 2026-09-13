import {canonicalJson,sha256} from '../../canonical.ts';
import type {ProceduralPlaybook} from '../../procedural-intelligence.ts';
import {buildOwnerIsolatedRepairInput,FROZEN_MOVEMENT_REGRESSION,HELD_OUT_MOVEMENT_REGRESSION,type IsolatedSoftwareRepairResult} from '../../isolated-software-repair.ts';
import type {ProgramCandidateProposal} from '../../types.ts';
import type {ProgramVerificationResult} from '../../coding-repair-types.ts';
import type {ExecutionContext} from '../types.ts';
import type {Json} from '../schema.ts';

export const repairCandidateSource=(requestId:string)=>`kernel:isolated-defect-repairer:${requestId}`;
const artifact=(candidate:ProgramCandidateProposal)=>sha256(canonicalJson({schemaVersion:1,files:candidate.files.map(f=>({path:f.path,contentDigest:sha256(f.content)})).sort((a,b)=>a.path.localeCompare(b.path))}));
const completeChecks=(v:ProgramVerificationResult|null)=>Boolean(v&&(['source_policy','syntax','typecheck','behavior_tests','artifact_integrity'] as const).every(c=>v.completedChecks.includes(c)));
const failsBehavior=(v:ProgramVerificationResult|null)=>Boolean(v&&!v.passed&&completeChecks(v)&&v.failures.length===1&&v.failures[0]!.kind==='behavior'&&v.failures[0]!.code==='GENOME_LAB_RUNTIME_FAILURE');

/** First-generation candidate from a kernel receipt, never a fabricated reuse
 * selection or commercial outcome. This validator performs no execution. */
export function verifiedRepairCandidate(input:Record<string,Json>,ctx:ExecutionContext):ProceduralPlaybook|null{
 if(input.sourceKind!=='ISOLATED_REPAIR_RECEIPT'||typeof input.sourceRequestId!=='string'||input.expectedKnowledgeDigest!==null||Object.keys(input).some(k=>!['sourceKind','sourceRequestId','expectedKnowledgeDigest'].includes(k)))return null;
 const matching=(ctx.priorCapabilityResults??[]).filter(r=>r.capability.id==='isolated-defect-repairer'&&r.requestId===input.sourceRequestId);
 if(matching.length!==1)return null;
 const receipt=matching[0]!;
 if(receipt.status!=='SUCCEEDED'||receipt.receiptValidity?.current!==true||receipt.authority.contextDigest!==ctx.authorityContextDigest)return null;
 // receiptValidity/replayed are read-time projections, not part of the hash.
 const {resultDigest,receiptValidity,replayed,...unsigned}=receipt;
 if(sha256(canonicalJson(unsigned))!==resultDigest)return null;
 const output=receipt.output as Record<string,Json>,e=output.evidence as unknown as IsolatedSoftwareRepairResult|null;
 if(output.qualified!==true||output.result!=='VERIFIED_ISOLATED_REPAIR'||output.synthetic!==true||output.provenance!=='ISOLATED'||!e||!e.candidate)return null;
 if(e.actor!=='SARA_RUNTIME'||e.synthetic!==true||e.provenance!=='ISOLATED'||e.profile!=='nicos-seeded-comparator-v1'||e.status!=='VERIFIED_ISOLATED_REPAIR'||!e.qualified||!e.causalControlEstablished||e.comparisonHypothesis.status!=='SUPPORTED_BY_CAUSAL_CONTROL'||e.eligibilityStopCode!==null||e.interruptedAtStep!==null||e.authorityGranted!==false||e.productionChanged!==false||e.modelCalls!==0||e.providerCashUsd!==0)return null;
 try{
  const reviewed=buildOwnerIsolatedRepairInput({revision:e.source.revision,files:e.candidate.files,constitutionDigest:ctx.constitutionDigest});
  if(canonicalJson(reviewed.source)!==canonicalJson(e.source)||e.regressionSha256!==sha256(FROZEN_MOVEMENT_REGRESSION)||e.heldOutRegressionSha256!==sha256(HELD_OUT_MOVEMENT_REGRESSION))return null;
  if(e.verifiedCandidateDigest!==artifact(e.candidate)||typeof e.patch!=='string'||sha256(e.patch)!==e.patchSha256)return null;
  const sources=e.candidate.files.filter(f=>f.path.startsWith('src/')).map(f=>({path:f.path,sha256:sha256(f.content)})).sort((a,b)=>a.path.localeCompare(b.path));
  if(canonicalJson(sources)!==canonicalJson(e.verifiedSourceDigests)||sources.find(f=>f.path==='src/route.ts')?.sha256!==e.source.adaptedSha256)return null;
  const independent={...structuredClone(e.candidate),files:[...e.candidate.files,{path:'tests/independent.test.ts',content:HELD_OUT_MOVEMENT_REGRESSION}]};
  if(!e.independentVerification?.passed||!completeChecks(e.independentVerification)||e.independentVerification.failures.length||e.independentVerification.artifactDigest!==artifact(independent))return null;
  if(!failsBehavior(e.baselineVerification)||!failsBehavior(e.restoredBaselineVerification)||e.baselineVerification!.artifactDigest!==e.baselineArtifactDigest||e.restoredBaselineVerification!.artifactDigest!==e.baselineArtifactDigest||canonicalJson(e.baselineVerification!.failures)!==canonicalJson(e.restoredBaselineVerification!.failures))return null;
  const passing=e.attempts.filter(a=>a.verification.passed);
  if(e.attempts.length!==3||passing.length!==1||passing[0]!.candidateArtifactDigest!==e.verifiedCandidateDigest||passing[0]!.verification.artifactDigest!==e.verifiedCandidateDigest||!completeChecks(passing[0]!.verification)||passing[0]!.verification.failures.length)return null;
 }catch{return null;}
 const id=`repair-candidate-${sha256(canonicalJson({receipt:resultDigest,profile:e.profile})).slice(0,40)}`;
 return {id,version:1,knowledgeClass:'PROCEDURAL',taskFamily:'isolated-comparator-repair',status:'CANDIDATE',
  triggers:['exact reviewed synthetic movement comparator fixture'],nonTriggers:['production defect','general repository repair','customer fulfillment'],
  purpose:'SYNTHETIC candidate procedure for the isolated three-comparator movement exercise; not a qualified reusable capability.',
  requiredInputs:['exact reviewed supplied source identity','frozen regression','current constitution and authenticated owner scope'],
  preconditions:['separate independent procedure qualification before selection','current exact owner authorization before any future execution','existing source and sandbox eligibility gates'],
  authorityRequired:['exact_owner_isolated_repair'],prohibitedActions:['production_change','merge','deployment','external_message','paid_model_call','commercial_fulfillment','automatic_promotion'],costCeilingUsd:0,
  tools:['existing-genome-lab-verifier'],preferredToolOrder:['existing-genome-lab-verifier'],fallbackToolOrder:[],
  procedure:['Validate the fixed synthetic source profile and frozen regression.','Establish a behavioral failure with completed source, compiler and integrity checks.','Enumerate at most three single-token comparator inversions within the exact editable file.','Require exactly one candidate to pass the unchanged regression.','Run the independent held-out regression against the exact candidate.','Restore the seeded baseline and require the same behavioral failure.','Preserve patch, artifact hashes, failed attempts and untested scope.'],
  decisionBranches:['No reproduced failure: preserve the scoped no-failure result without a repair.','Ambiguous candidate, revoked authority or incomplete verification: do not release or qualify a repair.'],expectedFailureModes:['unreviewed source','runner failure','ambiguous candidates','stale receipt','stop or cancellation'],negativeLessons:['A seeded exercise does not establish general repair competence or live application correctness.'],
  verificationSteps:['fresh frozen regression','independent held-out candidate verification','restored-baseline causal control'],acceptanceCriteria:['all exact receipt and artifact identities match','independent procedure qualification remains pending'],
  evidenceRequired:['current kernel repair receipt','candidate and patch hashes','frozen and held-out regression hashes','restored baseline failure'],rollback:['retain historical evidence and stop execution'],sideEffects:['candidate-only procedural store record; no execution authority'],
  provenance:{producerIdentity:'sara-repair-receipt-candidate-compiler',source:repairCandidateSource(receipt.requestId)},sourceEvidence:[resultDigest,e.verifiedCandidateDigest!,e.patchSha256!,e.regressionSha256,e.heldOutRegressionSha256],
  qualificationStatus:'pending_independent_qualification',qualificationDigest:'',evaluatorIdentity:'unassigned',procedureApplicabilityIdentity:{synthetic:true,repairProfile:e.profile,policyDigest:ctx.constitutionDigest},
  evidenceReuseIdentity:{synthetic:true,repairProfile:e.profile,sourceRevision:e.source.revision,artifactDigest:e.verifiedCandidateDigest!,policyDigest:ctx.constitutionDigest,authorityContextDigest:ctx.authorityContextDigest},
  environmentAssumptions:['SYNTHETIC isolated TypeScript subset; no live state or credentials','Existing infrastructure allocation remains UNKNOWN'],dependencyAssumptions:['Exact frozen and held-out regression identities'],
  invalidationConditions:['SOURCE_CHANGED','DEPENDENCY_CHANGED','CONFIGURATION_CHANGED','ENVIRONMENT_CHANGED','REQUIREMENT_CHANGED','POLICY_CHANGED','AUTHORITY_CHANGED','EVIDENCE_CORRUPT'],lastVerifiedRevision:e.source.revision,supersedes:[],supersededBy:null,
  createdAt:new Date().toISOString(),verifiedAt:null,qualificationStrength:0};
}
