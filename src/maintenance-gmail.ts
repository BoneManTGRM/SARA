import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, sha256 } from './canonical.ts';
import { GMAIL_REPORT_SENDER } from './gmail-oauth-activation.ts';
import type { SaraKernel } from './kernel.ts';
import type { MaintenanceJob } from './website-maintenance.ts';

const recipient = 'reparodynamics@gmail.com';
type Receipt = { version:1; identity:string; providerId:string; sender:string; recipient:string };
type Options = { kernel:SaraKernel; stateDirectory:string; clientId:string; clientSecret:string; refreshToken:string; fetchImpl?:typeof fetch };

/** Gmail transport for the exact owner-approved gift job. Not a general mailbox agent. */
export class MaintenanceGmailNotifier {
  private readonly fetchImpl:typeof fetch;
  private readonly options:Readonly<Options>;
  constructor(options:Options) {
    for(const secret of [options.clientId,options.clientSecret,options.refreshToken])if(typeof secret!=='string'||secret.trim().length<8)throw new Error('MAINTENANCE_GMAIL_NOT_CONFIGURED');
    this.options=Object.freeze({...options});
    this.fetchImpl=options.fetchImpl??fetch;
  }
  private async job(id:string):Promise<MaintenanceJob> {
    if(!/^maint_[a-f0-9]{32}$/.test(id))throw new Error('INVALID_MAINTENANCE_ID');
    const job=(await this.options.kernel.listWebsiteMaintenance()).find(j=>j.request.id===id);
    if(!job||job.request.funding!=='GIFT'||job.request.maximumCostUsd!==0||!job.candidateDigest||!job.deploymentReceipt)throw new Error('VERIFIED_MAINTENANCE_REQUIRED');
    return job;
  }
  private identity(job:MaintenanceJob):string {
    return sha256(canonicalJson({request:job.request,digest:job.candidateDigest,deployment:job.deploymentReceipt,sender:GMAIL_REPORT_SENDER,recipient}));
  }
  private folder(id:string):string {return join(this.options.stateDirectory,'website-maintenance',id,'gmail');}
  private async absent(path:string):Promise<boolean> {
    try {await readFile(path);return false;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}
  }
  async findNotification(id:string):Promise<{receipt:string}|null> {
    const job=await this.job(id),folder=this.folder(id);
    if(!await this.absent(join(folder,'receipt.json'))){
      const value=JSON.parse(await readFile(join(folder,'receipt.json'),'utf8')) as Receipt;
      if(value.version!==1||value.identity!==this.identity(job)||value.sender!==GMAIL_REPORT_SENDER||value.recipient!==recipient||!/^[-a-zA-Z0-9_]{4,200}$/.test(value.providerId))throw new Error('INVALID_GMAIL_RECEIPT');
      return {receipt:`gmail:${value.providerId}`};
    }
    if(!await this.absent(join(folder,'attempt.json'))||!await this.absent(join(folder,'lock')))throw new Error('GMAIL_DELIVERY_UNCERTAIN_RECONCILE_REQUIRED');
    return null;
  }
  private async writeDurably(path:string,value:unknown):Promise<void> {
    const temporary=`${path}.${randomUUID()}.tmp`,file=await open(temporary,'wx',0o600);
    try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
    await rename(temporary,path);
    const directory=await open(join(path,'..'),'r');try{await directory.sync();}finally{await directory.close();}
  }
  private async assertRunning():Promise<void> {
    const status=await this.options.kernel.getStatus();
    if(status.emergencyStopped||!status.constitution.verified)throw new Error('MAINTENANCE_NOTIFICATION_STOPPED');
  }
  private async accessToken():Promise<string> {
    await this.assertRunning();
    const response=await this.fetchImpl('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:this.options.clientId,client_secret:this.options.clientSecret,refresh_token:this.options.refreshToken,grant_type:'refresh_token'}),
      redirect:'error',signal:AbortSignal.timeout(15000)
    });
    if(!response.ok)throw new Error('GMAIL_TOKEN_REFRESH_FAILED');
    const token=await response.json() as {access_token?:unknown;token_type?:unknown};
    if(typeof token.access_token!=='string'||String(token.token_type).toLowerCase()!=='bearer')throw new Error('GMAIL_TOKEN_REFRESH_FAILED');
    await this.assertRunning();
    const identity=await this.fetchImpl('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${token.access_token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!identity.ok)throw new Error('GMAIL_IDENTITY_NOT_VERIFIED');
    const profile=await identity.json() as {email?:unknown;email_verified?:unknown};
    if(profile.email!==GMAIL_REPORT_SENDER||profile.email_verified!==true)throw new Error('GMAIL_IDENTITY_MISMATCH');
    return token.access_token;
  }
  async notify(input:{idempotencyKey:string;deploymentReceipt:string;digest:string}):Promise<{receipt:string}> {
    const job=await this.job(input.idempotencyKey);
    if(job.state!=='NOTIFY_INTENT'||job.deploymentReceipt!==input.deploymentReceipt||job.candidateDigest!==input.digest)throw new Error('MAINTENANCE_NOTIFICATION_NOT_AUTHORIZED');
    const previous=await this.findNotification(job.request.id);if(previous)return previous;
    const folder=this.folder(job.request.id);await mkdir(folder,{recursive:true,mode:0o700});
    const lock=await open(join(folder,'lock'),'wx',0o600);
    try {
      // Recheck while holding the cross-process lock; never resend a claimed attempt.
      if(!await this.absent(join(folder,'attempt.json'))||!await this.absent(join(folder,'receipt.json')))throw new Error('GMAIL_ATTEMPT_ALREADY_EXISTS');
      const token=await this.accessToken();
      const current=await this.job(job.request.id),status=await this.options.kernel.getStatus();
      if(status.emergencyStopped||!status.constitution.verified||current.state!=='NOTIFY_INTENT'||current.revision!==job.revision)throw new Error('MAINTENANCE_NOTIFICATION_STOPPED');
      const identity=this.identity(job);
      const content=[`Website maintenance completed for ${job.request.projectId}.`,`Job: ${job.request.id}`,`Verified content SHA-256: ${job.candidateDigest}`,`Deployment receipt: ${job.deploymentReceipt}`,'Gift demonstration: no customer revenue recorded.'].join('\n');
      const mime=[`From: SARA <${GMAIL_REPORT_SENDER}>`,`To: ${recipient}`,'Subject: SARA website maintenance completed',`Message-ID: <${job.request.id}@sara.reparodynamics.gmail>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(content).toString('base64').match(/.{1,76}/g)!.join('\r\n'),''].join('\r\n');
      await this.writeDurably(join(folder,'attempt.json'),{version:1,identity,state:'dispatch_intent'});
      await this.assertRunning();
      const result=await this.fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({raw:Buffer.from(mime).toString('base64url')}),redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!result.ok)throw new Error('GMAIL_SEND_NOT_CONFIRMED');
      const sent=await result.json() as {id?:unknown};
      if(typeof sent.id!=='string'||!/^[-a-zA-Z0-9_]{4,200}$/.test(sent.id))throw new Error('GMAIL_SEND_NOT_CONFIRMED');
      await this.writeDurably(join(folder,'receipt.json'),{version:1,identity,providerId:sent.id,sender:GMAIL_REPORT_SENDER,recipient} satisfies Receipt);
      return {receipt:`gmail:${sent.id}`};
    } finally {await lock.close();await rm(join(folder,'lock'));}
  }
}
