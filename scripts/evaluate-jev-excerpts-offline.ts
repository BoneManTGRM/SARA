import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {sha256} from '../src/canonical.ts';
import {jevExcerpt,JEV_EXCERPT_VERSION} from '../src/jev-excerpt.ts';
import {JEV_MODEL,JEV_QUESTION_VERSION} from '../src/jev-second-brain.ts';
// No transport, credential, provider invocation or funding surface.
const bytes=await readFile(new URL('../tests/fixtures/jev-excerpt-placement.v1.json',import.meta.url),'utf8');
const f=JSON.parse(bytes) as {version:string;conditions:{sourceLength:number;positions:number[];padding:string;topics:string[]};targetTemplate:string;expected:{cases:number;minimumExactTargetRetention:number;allExcerptsVerbatimAndBounded:boolean;noDeclineFromHeadOnly:boolean}};
const outcomes=[];
for(const topic of f.conditions.topics)for(const position of f.conditions.positions){
 const target=f.targetTemplate.replace('{topic}',topic),padding=f.conditions.padding.repeat(Math.ceil(f.conditions.sourceLength/f.conditions.padding.length));
 const source=padding.slice(0,position)+target+padding.slice(position+target.length,f.conditions.sourceLength);
 const start=performance.now(),excerpt=jevExcerpt(source,topic),elapsedMs=performance.now()-start;
 outcomes.push({topic,position,sourceDigest:sha256(source),headOnlyRetained:source.slice(0,1500).includes(target),queryWindowRetained:excerpt.text.includes(target),verbatim:excerpt.text===source.slice(excerpt.excerptStart,excerpt.excerptEnd),bounded:excerpt.text.length<=1500,start:excerpt.excerptStart,end:excerpt.excerptEnd,elapsedMs});
}
const retained=outcomes.filter(o=>o.queryWindowRetained).length,baseline=outcomes.filter(o=>o.headOnlyRetained).length,times=outcomes.map(o=>o.elapsedMs).sort((a,b)=>a-b);
const accepted=outcomes.length===f.expected.cases&&retained/outcomes.length>=f.expected.minimumExactTargetRetention&&retained>=baseline&&outcomes.every(o=>o.verbatim&&o.bounded);
console.log(JSON.stringify({version:f.version,fixtureDigest:sha256(bytes),excerptVersion:JEV_EXCERPT_VERSION,model:JEV_MODEL,questionVersion:JEV_QUESTION_VERSION,mode:'offline_exact_text_retention_only',accepted,thresholds:f.expected,cases:outcomes.length,headOnlyRetained:baseline,queryWindowRetained:retained,p95LocalLatencyMs:times[Math.ceil(times.length*.95)-1],providerCalls:0,providerUsage:null,liveJevAccuracy:'unknown',promoted:false,limitations:['Synthetic placement checks measure visible evidence, not model accuracy or general retrieval quality.','Lexical window selection can omit relevant nonmatching context; complete sources remain canonical.','No model superiority, calibrated threshold or 100x gain is established.'],outcomes},null,2));
if(!accepted)process.exitCode=1;
