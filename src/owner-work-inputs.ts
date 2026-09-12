import {defectReview} from './owner-defect-work.ts';
import {sha256} from './canonical.ts';
import type {Json} from './digital-capabilities/schema.ts';
import type {CapabilityPlan} from './digital-capabilities/plan.ts';

type ProposedStep={id:string;input:Json;completion:CapabilityPlan['steps'][number]['completion'];reason:string};
/** Bounded extraction of attributed facts, never policy, evidence grades or commands. */
export function suppliedReview(kind:string,body:string,sourceId:string,executeReproduction=false){
 const steps:ProposedStep[]=[],missing:string[]=[],fields:{field:string;kind:'OBSERVED'|'DERIVED'|'UNKNOWN';source:string}[]=[];
 const fact=(name:string,labels:string[],maximum=2048):string|null=>{
  const label=labels.join('|');
  const pattern=new RegExp(`^\\s*(?:${label})\\s*(?::|\\bis\\b)\\s*(.+?)\\s*$`,'iu');
  const values=[...new Set(body.split(/\r?\n/u).flatMap(line=>{const match=pattern.exec(line);return match?[match[1]!.trim()]:[];}))];
  const value=values.length===1&&values[0]!.length<=maximum?values[0]!:null;
  if(value===null)missing.push(values.length>1?`Conflicting ${name} values were supplied; identify the intended value.`:values[0]?`${name} exceeds its ${maximum}-character bound.`:`What is the ${name}? It was not stated unambiguously.`);
  fields.push({field:name,kind:value===null?'UNKNOWN':'OBSERVED',source:sourceId});return value;
 };
 const money=(name:string,labels:string[]):number|null=>{
  const value=fact(name,labels,64);if(value===null)return null;
  const match=/^USD\s+(\d{1,7})(?:\.(\d{1,6}))?\.?$/u.exec(value);
  const micro=match?Number(BigInt(match[1]!)*1000000n+BigInt((match[2]??'').padEnd(6,'0'))):null;
  if(micro===null||micro>1_000_000_000_000){missing.push(`${name} needs one explicit USD amount within the existing calculation bound; no currency conversion or zero assumption was made.`);return null;}
  fields.push({field:`${name}.microUsd`,kind:'DERIVED',source:`Exact integer conversion of ${sourceId}`});return micro;
 };
 const add=(id:string,input:Json,path:string[],equals:Json,reason:string)=>steps.push({id,input,completion:[{path,equals}],reason});
 if(kind==='supplied-defect')return defectReview(body,sourceId,executeReproduction);
 else{
  fields.push({field:'opportunityId',kind:'DERIVED',source:`Unapproved supplied material identity: ${sourceId}`});
  const price=money('price',['price','proposed price']),cost={directCashMicroUsd:money('direct cash cost',['direct cash cost']),modelApiMicroUsd:money('model API cost',['model API cost']),infrastructureMicroUsd:money('infrastructure cost',['infrastructure cost']),toolingMicroUsd:money('tooling cost',['tooling cost']),allocatedMicroUsd:null,modeledLaborMicroUsd:null};
  const risk=money('risk reserve',['risk reserve']);
  const margin=fact('minimum margin',['minimum margin'],64),match=margin?/^(\d{1,2}|100)(?:\.(\d{1,4}))?%\.?$/u.exec(margin):null;
  const minimum=match?Number(match[1])*10000+Number((match[2]??'').padEnd(4,'0')):null;
  if(margin!==null&&(!match||minimum!>1000000))missing.push('Minimum margin must be an explicit percentage from 0% through 100%.');
  if(minimum!==null&&minimum<=1000000)add('quote-margin-guard',{cost,riskReserveMicroUsd:risk,proposedPriceMicroUsd:price,minimumMarginPpm:minimum},['spendingAuthorized'],false,'Calculate the stated USD price and cash contribution using exact integer amounts; missing costs stay unknown and expectations never become revenue.');
  const problem=fact('problem',['problem','requested outcome'],4096),deliverables=fact('deliverables',['deliverables']),criteria=fact('acceptance criteria',['acceptance criteria']);
  if(problem)add('proposal-compiler',{opportunityId:`supplied-${sha256(sourceId)}`,approvalReceiptId:null,problem,scope:[problem],deliverables:deliverables?[deliverables]:[],exclusions:[],acceptanceCriteria:criteria?[criteria]:[],sequence:[],priceMicro:price,currency:price===null?null:'USD',paymentAssumptions:[],customerResponsibilities:[],limitations:['Supplied scope, cost and price estimates are unverified. No opportunity approval, customer acceptance, payment or delivery evidence was retrieved.']},['bindingOffer'],false,'Prepare only supplied proposal content; do not manufacture the exact opportunity approval receipt or binding terms.');
  missing.push('No exact opportunity approval was retrieved. This supplied draft is not bound to an existing approved opportunity; that identity and its approval evidence remain required.',
   'Scope exclusions, customer responsibilities and payment terms remain unspecified. Capability readiness and customer acceptance require an identified existing work subject and its evidence.');
 }
 return {steps,fields,missing,summary:undefined};
}
