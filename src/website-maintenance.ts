import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, sha256 } from './canonical.ts';
import type { SaraKernel } from './kernel.ts';
import { SARA_PRINCIPAL } from './kernel.ts';

export type MaintenanceRequest = {
  id: string; projectId: string; baseDigest: string; slot: string;
  before: string; after: string; funding: 'GIFT'; maximumCostUsd: 0;
};
export type MaintenanceState = 'QUEUED'|'PREPARED'|'PUBLISH_INTENT'|'PUBLISHED'|'NOTIFY_INTENT'|'DELIVERED'|'ROLLBACK_INTENT'|'ROLLED_BACK'|'BLOCKED';
export type MaintenanceJob = {
  request: MaintenanceRequest; revision: number; state: MaintenanceState;
  candidateDigest: string|null; deploymentReceipt: string|null;
  notificationReceipt: string|null; rollbackReceipt: string|null; reason: string|null;
  attempts: number; retryAt: string|null;
  createdAt: string; updatedAt: string;
};
export type MaintenanceProvider = {
  /** Trusted host binding to exactly one project. No request-supplied URL or token. */
  projectId: string;
  readSource(): Promise<string>;
  publish(input:{idempotencyKey:string;baseDigest:string;content:string;digest:string}):Promise<{receipt:string}>;
  findPublication(idempotencyKey:string):Promise<{receipt:string}|null>;
  readPublished(receipt:string):Promise<string>;
  notify(input:{idempotencyKey:string;deploymentReceipt:string;digest:string}):Promise<{receipt:string}>;
  findNotification(idempotencyKey:string):Promise<{receipt:string}|null>;
  /** Must compare the current deployment with failedReceipt; never overwrite newer work. */
  rollback(input:{idempotencyKey:string;failedReceipt:string;content:string;digest:string}):Promise<{receipt:string}>;
  findRollback(idempotencyKey:string):Promise<{receipt:string}|null>;
};
const digestPattern=/^[a-f0-9]{64}$/;
export function validateMaintenanceRequest(input:MaintenanceRequest):MaintenanceRequest {
  if(!input||typeof input!=='object'||!/^maint_[a-f0-9]{32}$/.test(input.id)||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.projectId)||!digestPattern.test(input.baseDigest)||!/^[a-z][a-z0-9-]{0,39}$/.test(input.slot))throw new Error('INVALID_MAINTENANCE_IDENTITY');
  if(input.funding!=='GIFT'||input.maximumCostUsd!==0)throw new Error('COMMERCIAL_MAINTENANCE_NOT_ACTIVATED');
  for(const text of [input.before,input.after])if(typeof text!=='string'||!text.trim()||text.length>2000||/[\u0000-\u001f\u007f<>]/.test(text))throw new Error('LITERAL_TEXT_REQUIRED');
  if(input.before===input.after)throw new Error('NO_CHANGE');
  return {id:input.id,projectId:input.projectId,baseDigest:input.baseDigest,slot:input.slot,before:input.before,after:input.after,funding:'GIFT',maximumCostUsd:0};
}
const escaped=(text:string)=>text.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
/** Only a marker-bound text node can change. Existing executable content is never run. */
export function prepareMaintenance(source:string,input:MaintenanceRequest):string {
  const request=validateMaintenanceRequest(input);
  if(Buffer.byteLength(source)>1_000_000||sha256(source)!==request.baseDigest)throw new Error('SOURCE_CHANGED');
  const begin=`<!-- sara:${request.slot} -->`,end=`<!-- /sara:${request.slot} -->`;
  if(source.split(begin).length!==2||source.split(end).length!==2)throw new Error('UNIQUE_CONTENT_SLOT_REQUIRED');
  const start=source.indexOf(begin)+begin.length,finish=source.indexOf(end);
  if(finish<start||source.slice(start,finish)!==escaped(request.before))throw new Error('EXACT_TEXT_MISMATCH');
  // Recognize whole comments and quoted attributes. Raw-text/foreign documents
  // are deliberately outside this initial static-page editing capability.
  if(/<\s*\/?\s*(?:script|style|textarea|xmp|iframe|noscript|plaintext|svg|math)(?:\s|>|\/)/i.test(source))throw new Error('UNSAFE_CONTENT_SLOT');
  const tokens=/<!--[\s\S]*?-->|<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  let cursor=0,seenBegin=false,seenEnd=false,inTitle=false;
  for(const token of source.matchAll(tokens)){
    if(source.slice(cursor,token.index).includes('<'))throw new Error('MALFORMED_HTML');
    if(/^<title(?:\s|>)/i.test(token[0]))inTitle=true;
    if(/^<\/title\s*>/i.test(token[0]))inTitle=false;
    if(token[0]===begin&&!inTitle)seenBegin=true;
    if(token[0]===end&&!inTitle)seenEnd=true;
    cursor=token.index+token[0].length;
  }
  if(source.slice(cursor).includes('<')||!seenBegin||!seenEnd)throw new Error('UNSAFE_CONTENT_SLOT');
  return source.slice(0,start)+escaped(request.after)+source.slice(finish);
}
export function verifyMaintenance(source:string,candidate:string,input:MaintenanceRequest):string {
  const begin=`<!-- sara:${input.slot} -->`,end=`<!-- /sara:${input.slot} -->`;
  const sourceStart=source.indexOf(begin)+begin.length,sourceEnd=source.indexOf(end);
  const candidateStart=candidate.indexOf(begin)+begin.length,candidateEnd=candidate.indexOf(end);
  if(sha256(source)!==input.baseDigest||sourceStart<begin.length||sourceEnd<sourceStart||candidateEnd<candidateStart||source.slice(0,sourceStart)!==candidate.slice(0,candidateStart)||source.slice(sourceEnd)!==candidate.slice(candidateEnd)||candidate.slice(candidateStart,candidateEnd)!==escaped(input.after))throw new Error('INDEPENDENT_VERIFICATION_FAILED');
  if(prepareMaintenance(source,input)!==candidate)throw new Error('UNEXPECTED_CHANGE');
  return sha256(candidate);
}
export function maintenanceJobs(events:ReadonlyArray<{type:string;data:unknown}>):MaintenanceJob[] {
  const jobs=new Map<string,MaintenanceJob>();
  for(const event of events)if(event.type==='website_maintenance_snapshot'){const job=event.data as MaintenanceJob;jobs.set(job.request.id,structuredClone(job));}
  return [...jobs.values()];
}
export const maintenanceRequestDigest=(request:MaintenanceRequest)=>sha256(canonicalJson(validateMaintenanceRequest(request)));

/** Host-owned scheduler; no model, shell execution, or additional billable service. */
export class WebsiteMaintenanceOperator {
  private busy=false;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private stopped=true;
  constructor(private readonly kernel:SaraKernel,private readonly directory:string,private readonly provider:MaintenanceProvider|null){}
  start(){if(!this.stopped)return;this.stopped=false;const loop=async()=>{try{await this.tick();}catch{/* State remains durable; no claim of completion. */}finally{if(!this.stopped)this.timer=setTimeout(loop,5000);}};void loop();}
  stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
  private async enabled(){const s=await this.kernel.getStatus();return !s.emergencyStopped&&s.constitution.verified;}
  async tick():Promise<string>{
    if(this.busy)return 'BUSY';this.busy=true;
    let active:MaintenanceJob|undefined;
    try{
      if(!await this.enabled())return 'STOPPED';
      const jobs=maintenanceJobs(await this.kernel.inspectAudit());
      const job=jobs.filter(x=>!['DELIVERED','ROLLED_BACK','BLOCKED'].includes(x.state)&&(!x.retryAt||Date.parse(x.retryAt)<=Date.now())).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt))[0];if(!job)return 'IDLE';active=job;
      const update=async(state:MaintenanceState,patch:Partial<MaintenanceJob>={})=>this.kernel.advanceWebsiteMaintenance(SARA_PRINCIPAL,job.request.id,job.revision,{state,...patch});
      if(!this.provider||this.provider.projectId!==job.request.projectId){await update('BLOCKED',{reason:'PROJECT_PROVIDER_NOT_CONNECTED'});return 'BLOCKED';}
      const folder=join(this.directory,'website-maintenance',job.request.id);await mkdir(folder,{recursive:true,mode:0o700});
      if(job.state==='QUEUED'){
        const source=await this.provider.readSource();const candidate=prepareMaintenance(source,job.request);const candidateDigest=verifyMaintenance(source,candidate,job.request);
        await writeFile(join(folder,'source.html'),source,{mode:0o600});await writeFile(join(folder,'candidate.html'),candidate,{mode:0o600});
        await update('PREPARED',{candidateDigest});return 'PREPARED';
      }
      if(job.state==='PREPARED'){
        const source=await readFile(join(folder,'source.html'),'utf8'),candidate=await readFile(join(folder,'candidate.html'),'utf8');
        if(verifyMaintenance(source,candidate,job.request)!==job.candidateDigest)throw new Error('ARTIFACT_TAMPERED');
        await update('PUBLISH_INTENT');return 'PUBLISH_INTENT';
      }
      if(job.state==='PUBLISH_INTENT'){
        // Never publish blindly after restart: provider must support lookup plus stable idempotency.
        let publication=await this.provider.findPublication(job.request.id);
        if(!publication){
          const source=await this.provider.readSource();const candidate=await readFile(join(folder,'candidate.html'),'utf8');
          if(verifyMaintenance(source,candidate,job.request)!==job.candidateDigest)throw new Error('ARTIFACT_TAMPERED');
          if(!await this.enabled())return 'STOPPED';
          publication=await this.provider.publish({idempotencyKey:job.request.id,baseDigest:job.request.baseDigest,content:candidate,digest:job.candidateDigest!});
        }
        if(!publication.receipt)throw new Error('DEPLOYMENT_RECEIPT_REQUIRED');
        if(sha256(await this.provider.readPublished(publication.receipt))!==job.candidateDigest){
          await update('ROLLBACK_INTENT',{deploymentReceipt:publication.receipt});return 'ROLLBACK_INTENT';
        }
        await update('PUBLISHED',{deploymentReceipt:publication.receipt});return 'PUBLISHED';
      }
      if(job.state==='ROLLBACK_INTENT'){
        let rollback=await this.provider.findRollback(job.request.id);
        if(!rollback){
          const content=await readFile(join(folder,'source.html'),'utf8');
          if(sha256(content)!==job.request.baseDigest)throw new Error('ROLLBACK_SOURCE_TAMPERED');
          if(!await this.enabled())return 'STOPPED';
          rollback=await this.provider.rollback({idempotencyKey:job.request.id,failedReceipt:job.deploymentReceipt!,content,digest:job.request.baseDigest});
        }
        if(!rollback.receipt||sha256(await this.provider.readPublished(rollback.receipt))!==job.request.baseDigest)throw new Error('ROLLBACK_NOT_VERIFIED');
        await update('ROLLED_BACK',{rollbackReceipt:rollback.receipt});return 'ROLLED_BACK';
      }
      if(job.state==='PUBLISHED'){await update('NOTIFY_INTENT');return 'NOTIFY_INTENT';}
      if(job.state==='NOTIFY_INTENT'){
        let notification=await this.provider.findNotification(job.request.id);
        if(!notification){if(!await this.enabled())return 'STOPPED';notification=await this.provider.notify({idempotencyKey:job.request.id,deploymentReceipt:job.deploymentReceipt!,digest:job.candidateDigest!});}
        if(!notification.receipt)throw new Error('DELIVERY_NOT_CONFIRMED');
        await update('DELIVERED',{notificationReceipt:notification.receipt});return 'DELIVERED';
      }
      return job.state;
    }catch(error){
      if(active&&await this.enabled()){
        // Preserve the current intent for reconciliation; bounded retries do not silently discard obligations.
        await this.kernel.deferWebsiteMaintenance(SARA_PRINCIPAL,active.request.id,active.revision).catch(()=>{});
      }
      throw error;
    }finally{this.busy=false;}
  }
}
export const newMaintenanceId=()=>`maint_${randomUUID().replaceAll('-','')}`;
