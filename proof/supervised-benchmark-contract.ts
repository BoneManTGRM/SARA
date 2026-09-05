import {readFile} from 'node:fs/promises';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {INITIAL_CODING_REPAIR_LIMITS} from '../src/coding-repair-policy.ts';
/** This integration proof is deliberately ineligible for paid execution. A fresh task needs a fresh review. */
export async function loadSupervisedContract(){
 const manifest=JSON.parse(await readFile('proof/live-v7-source-manifest.json','utf8')) as Record<string,string>;
 for(const [path,digest]of Object.entries(manifest)){
  if(!/^(src|proof|scripts|constitution|docs|tgrm)\/[a-zA-Z0-9_.\/-]+$/.test(path)&&!['package.json','package-lock.json','tsconfig.json'].includes(path))throw Error('MANIFEST_PATH');
  if(path.includes('..')||sha256(await readFile(path))!==digest)throw Error('SOURCE_MANIFEST_MISMATCH');
 }
 const contract={schemaVersion:1,caseId:'v7-supervised-offline-01',paidAllowed:false,
  purpose:'offline admission, transport, diagnostic and independent-verifier integration only',
  inheritedRuntime:'b451a41dc7add73613c0580a9b101ddd390a93a6',
  sourceManifestDigest:sha256(canonicalJson(manifest)),model:'gpt-5.6-luna',reasoning:'medium',
  limits:INITIAL_CODING_REPAIR_LIMITS,physicalSpendCeilingUsd:0.15,physicalPerArmCeilingUsd:0.075,
  maximumGenerations:6,maximumGenerationsPerArm:3,automaticRelaunch:false,providerKeyInWorker:false,
  deploymentStartup:'idle',generalClaimSupported:false};
 return {...contract,digest:sha256(canonicalJson(contract))};
}
