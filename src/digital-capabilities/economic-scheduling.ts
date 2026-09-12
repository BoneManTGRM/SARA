import {canonicalJson,sha256} from '../canonical.ts';
import type {Job} from '../types.ts';
import type {RevenuePilotJob} from '../revenue-pilot.ts';
import type {StoredEvent} from '../store.ts';
import type {CapabilityResult} from './types.ts';
import {compareWorkValues} from './economic/definitions.ts';
import type {Data} from './engineering/common.ts';
export function jobEconomicSubjectDigest(jobs:readonly Job[],revenueJobs:readonly RevenuePilotJob[],id:string):string|undefined {
 const self=jobs.find(j=>j.id===id),revenue=revenueJobs.find(j=>j.id===id);if(Boolean(self)===Boolean(revenue))return undefined;
 return sha256(canonicalJson(self?{kind:'self_development',job:self}:{kind:'revenue',job:revenue}));
}
/** Only self-contained numerical forecasts are eligible here. Referenced analyses
 * use the normal capability evidence resolver; unresolved dependencies never
 * silently become a scheduling score. This grants no execution authority. */
export function currentJobEconomics(input:{events:readonly StoredEvent[];jobs:readonly Job[];revenueJobs:readonly RevenuePilotJob[];authorityContextDigest:string;contractDigest:string}):Map<string,{resultDigest:string;value:Data}> {
 const result=new Map<string,{resultDigest:string;value:Data}>();
 for(const e of input.events){if(e.type!=='digital_capability_executed')continue;const r=(e.data as {result:CapabilityResult}).result;
  if(r.capability.id!=='economic-value-of-work'||r.status!=='SUCCEEDED'||r.capability.contractDigest!==input.contractDigest||r.authority.contextDigest!==input.authorityContextDigest||r.evidence.length)continue;
  const {resultDigest,...unsigned}=r;if(sha256(canonicalJson(unsigned))!==resultDigest)throw new Error('ECONOMIC_RECEIPT_INTEGRITY_FAILURE');
  const value=r.output as Data,workId=value.workId;if(typeof workId!=='string')continue;const subjectDigest=jobEconomicSubjectDigest(input.jobs,input.revenueJobs,workId);if(!subjectDigest||r.subject.workSubjectDigest!==subjectDigest)continue;
  result.set(workId,{resultDigest,value});
 }
 return result;
}
export function compareJobEconomics(aId:string,bId:string,values:Map<string,{resultDigest:string;value:Data}>):number {
 const a=values.get(aId),b=values.get(bId);if(a&&b)return compareWorkValues(a.value,b.value);return Number(Boolean(b))-Number(Boolean(a));
}
