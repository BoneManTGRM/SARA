import {readFile} from 'node:fs/promises';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {INITIAL_CODING_REPAIR_LIMITS} from '../src/coding-repair-policy.ts';
import {baseline,reference,objective,acceptanceCriteria,assertionCount} from './v8-live-fixture.ts';
export async function loadV8SupervisedContract(){
 const manifest=JSON.parse(await readFile('proof/live-v8-source-manifest.json','utf8')) as Record<string,string>;
 for(const [path,digest] of Object.entries(manifest)){
  if(!/^(src|proof|scripts|constitution|tgrm)\/[a-zA-Z0-9_.\/-]+$/u.test(path)&&!['package.json','package-lock.json','tsconfig.json','railway.json'].includes(path))throw Error('MANIFEST_PATH');
  if(path.includes('..')||!/^[a-f0-9]{64}$/u.test(digest)||sha256(await readFile(path))!==digest)throw Error('SOURCE_MANIFEST_MISMATCH');
 }
 const contract={schemaVersion:1,caseId:'bounded-inventory-basket-v8-live-01',paidAllowed:true,
  ownerRequest:'One actual fresh SARA comparison with proof and truthful Telegram results',
  inheritedRuntime:'b451a41dc7add73613c0580a9b101ddd390a93a6',inheritedIntegration:'23014289921e671f249ac62f598dbc831ceb6905',
  frozenV8FixtureCommit:'8f41f6e0be98a0985d20cf186f494dbc73fcbb89',
  sourceManifestDigest:sha256(canonicalJson(manifest)),baselineDigest:sha256(canonicalJson(baseline)),referenceDigest:sha256(canonicalJson(reference)),
  objective,acceptanceCriteria,hiddenAssertionCount:assertionCount,model:'gpt-5.6-luna',reasoning:'medium',
  limits:INITIAL_CODING_REPAIR_LIMITS,physicalSpendCeilingUsd:0.15,physicalPerArmCeilingUsd:0.075,
  maximumGenerations:6,maximumGenerationsPerArm:3,maximumInputTokens:30000,maximumOutputTokens:8000,
  armOrder:['compact_first','full_replacement'],sharedFirstProposal:false,
  treatment:'experimentalCompactFirstProposal_and_compactRepairContinuations',
  measure:'baseline_verification_to_independent_final_verification_including_model_accounting_round_trips',
  target:{speedRatio:4,requiresBothComplete:true,requiresNoHigherCost:true},
  frozenRates:{inputPerMillion:0.20,outputPerMillion:1.20,conservativeInputPerMillion:0.25},
  approval:'one owner GitHub file bound to source, deployment, service, 256-bit process challenge and expiry',
  maximumApprovalLifetimeMs:900000,automaticRelaunch:false,providerKeyInWorker:false,
  repeats:1,retainAllOutcomes:true,generalClaimSupported:false};
 return {...contract,digest:sha256(canonicalJson(contract))};
}
