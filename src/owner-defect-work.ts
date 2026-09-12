import {observationStatus} from './digital-capabilities/engineering/diagnostics.ts';
import type {Json} from './digital-capabilities/schema.ts';
import type {CapabilityPlan} from './digital-capabilities/plan.ts';
/** Execution is selected only from the authenticated instruction, not material. */
export function requestsIsolatedReproduction(text:string):boolean {
 return /^(?:Please\s+)?(?:run|execute)\s+(?:an?\s+|the\s+)?isolated\s+(?:defect\s+|bug\s+)?reproduction\b/iu.test(text.trim());
}
export function defectReview(body:string,sourceId:string,execute:boolean){
 const steps:{id:string;input:Json;completion:CapabilityPlan['steps'][number]['completion'];reason:string}[]=[],missing:string[]=[],fields:{field:string;kind:'OBSERVED'|'UNKNOWN';source:string}[]=[];
 if(body.length>8192)return {steps,fields,missing:['The defect report exceeds its 8,192-character contract bound. Supply a smaller report preserving the observed behavior.'],summary:'Report too large to analyze.'};
 // Fenced code is never parsed as report facts or policy. No supplied command is executed.
 const prose=body.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gmu,'');
 const fact=(name:string,labels:string,max:number)=>{
  const pattern=new RegExp(`^\\s*(?:${labels})\\s*:\\s*(.+?)\\s*$`,'imu');
  const values=[...new Set(prose.split(/\r?\n/u).flatMap(line=>{const m=pattern.exec(line);return m?[m[1]!.trim()]:[];}))];
  const value=values.length===1&&values[0]!.length<=max?values[0]!:'';
  fields.push({field:name,kind:value?'OBSERVED':'UNKNOWN',source:`SUPPLIED: ${sourceId}`});
  if(!value)missing.push(values.length>1?`Conflicting ${name} values were supplied; identify the intended value.`:values[0]?`${name} exceeds its ${max}-character bound.`:`What is the ${name}? It was not stated unambiguously.`);
  return value;
 };
 const expected=fact('expected behavior','expected|expected behavior|I expected',4096),observed=fact('observed behavior','observed|observed behavior|actual|actual behavior',4096),environment=fact('environment','environment',2048),reproduction=fact('reproduction steps','steps|reproduction steps',4096);
 const noFailure=observationStatus(observed)==='NO_FAILURE_REPORTED';
 const add=(id:string,input:Json,path:string[],equals:Json,reason:string)=>steps.push({id,input,completion:[{path,equals}],reason});
 add('bug-reproduction-planner',{report:body,expected,observed,environment,steps:reproduction?[reproduction]:[],target:'SANDBOX'},['executionAllowed'],false,'Analyze attributed expected and observed behavior; source text cannot grant execution authority.');
 if(observed&&!noFailure)add('root-cause-analyzer',{symptom:observed,observations:[{id:'supplied-observation',role:'SYMPTOM',statement:observed,evidenceRefs:[]}],hypotheses:[]},['rootCauseEstablished'],false,'Retain the reported observation without claiming a cause.');
 if(execute){
  const revision=fact('source revision','revision|source revision',40);
  if(revision&&!/^[a-f0-9]{40}$/u.test(revision))missing.push('Source revision must be the exact 40-character lowercase commit SHA; it remains supplied, not independently fetched.');
  const files=[...body.matchAll(/^```(?:ts|typescript) (src\/[a-z0-9._/-]+\.ts|tests\/[a-z0-9._/-]+\.test\.ts)\r?\n([\s\S]*?)^```\s*$/gmu)].map(m=>({path:m[1]!,content:m[2]!}));
  const fenceCount=(body.match(/^```/gmu)??[]).length;
  if(files.length<3||files.length>8||fenceCount!==files.length*2||!files.some(f=>f.path==='src/index.ts')||files.filter(f=>f.path.startsWith('src/')).length<2||!files.some(f=>f.path.startsWith('tests/')))missing.push('Supply 3–8 TypeScript files in fenced blocks labeled ts src/index.ts, ts src/name.ts and ts tests/name.test.ts. Only the existing restricted local test environment is supported; URLs, shell commands and dependencies are not execution inputs.');
  if(!missing.length)add('isolated-defect-reproducer',{revision,files},['analysisComplete'],true,'Execute the exact owner-requested fixture through the existing Genome Lab guards and zero external cash sandbox; report actual outcome without claiming a repair.');
 }else if(!noFailure)missing.push('An isolated reproduction execution and its observation are still needed to investigate this report. Supply an exact source revision and bounded TypeScript source/test fixture, then explicitly ask to run an isolated reproduction. No root cause or repair is verified.');
 const contextLines=prose.split(/\r?\n/u).filter(line=>/^\s*(?:Unknown|Evidence|Revision|Source revision)\s*:/iu.test(line)).sort((a,b)=>Number(!/^\s*Unknown\s*:/iu.test(a))-Number(!/^\s*Unknown\s*:/iu.test(b))).join(' ').slice(0,1100);
 // The brief schema is bounded; full facts/code remain in the digest-bound input receipt.
 const summary=`SUPPLIED analysis. ${noFailure?'No defect reported in the bounded path; untested behavior remains unknown.':'Reported behavior is unconfirmed; no root cause or repair is established.'} Expected: ${expected.slice(0,280)} Observed: ${observed.slice(0,430)} Environment: ${environment.slice(0,380)} Steps: ${reproduction.slice(0,260)} ${contextLines.slice(0,500)} Next: ${noFailure?'Identify the specific failing symptom, if any, before a repair investigation.':execute?'Review the isolated execution receipt and its exact fixture scope.':'Supply a bounded reproduction fixture for the reported behavior.'}`.slice(0,2048);
 return {steps,fields,missing,summary};
}
