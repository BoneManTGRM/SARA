import {readFile,writeFile} from 'node:fs/promises';
import {verifyGenomeLabProgramCandidate} from '../src/genome-lab-verifier.ts';
import {loadConstitution} from '../src/constitution.ts';
import {baseline,reference,objective,acceptanceCriteria,assertionCount} from './v7-live-fixture.ts';
import {canonicalJson,sha256} from '../src/canonical.ts';
import ts from 'typescript';
const rows:unknown[]=[]; const start=new Date().toISOString();
const {digest:constitutionDigest}=await loadConstitution();
for(let repeat=0;repeat<6;repeat++) for(const kind of repeat%2?['correct','broken']:['broken','correct']){
 const t=performance.now();const result=await verifyGenomeLabProgramCandidate({candidate:structuredClone(kind==='correct'?reference:baseline),objective,acceptanceCriteria,constitutionDigest});
 const row={repeat,kind,elapsedMs:performance.now()-t,...result};rows.push(row);
 console.log(JSON.stringify({repeat,kind,passed:result.passed,elapsedMs:row.elapsedMs}));
 if(result.passed!==(kind==='correct'))throw Error('Unexpected verifier outcome');
}
const record={schemaVersion:1,evidenceLevel:'EXECUTED_SARA_ORIGINAL_VERIFIER_NO_LIVE_MODEL',start,finish:new Date().toISOString(),sourceCommit:process.env.GITHUB_SHA??'23014289921e671f249ac62f598dbc831ceb6905',typescript:ts.version,node:process.version,assertionCount,verifierSha256:sha256(await readFile('src/genome-lab-verifier.ts')),rows,providerCalls:0,baselineIsHistoricalFixture:true,limitations:[ts.version==='5.9.3'?'Committed TypeScript version used.':'Local TypeScript differs from the committed toolchain.','No live coding speed comparison; no model-generated solutions in this measurement.','Repeated fixed fixture timings are not independent task-corpus observations.']};
await writeFile(process.env.SARA_FLOOR_OUTPUT??'verification-floor.json',JSON.stringify({...record,digest:sha256(canonicalJson(record))},null,2));
