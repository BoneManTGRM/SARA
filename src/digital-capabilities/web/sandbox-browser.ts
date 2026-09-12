import { spawn,type ChildProcess } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sha256 } from '../../canonical.ts';
import { CapabilityInputError } from '../schema.ts';
async function resolveFrontendNode(send:(method:string,params:Record<string,unknown>)=>Promise<any>,backendNodeId:number):Promise<number>{
 if(!Number.isSafeInteger(backendNodeId)||backendNodeId<1)throw new CapabilityInputError('STALE_SANDBOX_FIELD');
 const result=await send('DOM.pushNodesByBackendIdsToFrontend',{backendNodeIds:[backendNodeId]});
 if(!Array.isArray(result.nodeIds)||result.nodeIds.length!==1||!Number.isSafeInteger(result.nodeIds[0])||result.nodeIds[0]<1)throw new CapabilityInputError('STALE_SANDBOX_FIELD');
 return result.nodeIds[0];
}
export type BrowserEndpointReadiness={read:()=>Promise<string>;alive:()=>boolean;now:()=>number;pause:(milliseconds:number)=>Promise<void>};
export async function waitForSandboxBrowserEndpoint(input:BrowserEndpointReadiness):Promise<{port:number;path:string}>{
 const deadline=input.now()+10000;
 while(input.now()<deadline){
  if(!input.alive())throw new Error('SANDBOX_BROWSER_UNAVAILABLE');
  let file='';try{file=await input.read();}catch{/* Chrome has not published the endpoint file yet. */}
  if(!input.alive())throw new Error('SANDBOX_BROWSER_UNAVAILABLE');
  const lines=file.trim().split(/\r?\n/u),port=Number(lines[0]),path=lines[1];
  const ready=lines.length===2&&/^\d{1,5}$/u.test(lines[0]??'')&&port>0&&port<=65535&&/^\/devtools\/browser\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(path??'');
  if(ready&&input.now()<deadline)return {port,path:path!};
  const remaining=deadline-input.now();if(remaining>0)await input.pause(Math.min(50,remaining));
 }
 throw new Error('SANDBOX_BROWSER_ENDPOINT_UNAVAILABLE');
}
/** Trusted-host adapter. It can only render supplied HTML in a new, credential-free,
 * network-blocked browser context. No user-supplied protocol methods, URLs or scripts. */
export class SandboxBrowser {
 private constructor(private process:ChildProcess,private directory:string,private socket:WebSocket,private sessionId:string,private pending:Map<number,{resolve(v:any):void;reject(e:Error):void;timer:ReturnType<typeof setTimeout>}>,private next:()=>number,private lifetime:ReturnType<typeof setTimeout>){}
 private async send(method:string,params:Record<string,unknown>={}):Promise<any>{const id=this.next();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('SANDBOX_BROWSER_COMMAND_TIMEOUT'));},5000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params,sessionId:this.sessionId}));});}
 static async launch(executable:'google-chrome'|'chromium'|'chromium-browser'='google-chrome'):Promise<SandboxBrowser>{
  if(!['google-chrome','chromium','chromium-browser'].includes(executable))throw new Error('UNAPPROVED_BROWSER_EXECUTABLE');
  const directory=await mkdtemp(join(tmpdir(),'sara-sandbox-browser-'));const child=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${directory}`,'--no-first-run','--disable-background-networking','--disable-extensions','--disable-component-update','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','about:blank'],{stdio:'ignore',env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',HOME:directory}});
  let launchError=false;child.on('error',()=>{launchError=true;});const lifetime=setTimeout(()=>child.kill('SIGKILL'),30000);let socket:WebSocket|undefined;
  try{const {port,path}=await waitForSandboxBrowserEndpoint({read:()=>readFile(join(directory,'DevToolsActivePort'),'utf8'),alive:()=>!launchError&&child.exitCode===null&&child.signalCode===null,now:()=>performance.now(),pause:milliseconds=>delay(milliseconds)});socket=new WebSocket(`ws://127.0.0.1:${port}${path}`);await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('SANDBOX_BROWSER_CONNECT_TIMEOUT')),5000);socket!.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket!.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('SANDBOX_BROWSER_CONNECTION_FAILED'));},{once:true});});
   const pending=new Map<number,{resolve(v:any):void;reject(e:Error):void;timer:ReturnType<typeof setTimeout>}>();let counter=0;const next=()=>++counter;
   socket.addEventListener('message',event=>{let value:any;try{value=JSON.parse(String(event.data));}catch{child.kill('SIGKILL');return;}if(value.id){const wait=pending.get(value.id);if(!wait)return;clearTimeout(wait.timer);pending.delete(value.id);if(value.error)wait.reject(new Error('SANDBOX_BROWSER_PROTOCOL_ERROR'));else wait.resolve(value.result);}});
   const command=(method:string,params:Record<string,unknown>={})=>new Promise<any>((resolve,reject)=>{const id=next(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('SANDBOX_BROWSER_COMMAND_TIMEOUT'));},5000);pending.set(id,{resolve,reject,timer});socket!.send(JSON.stringify({id,method,params}));});
   const context=await command('Target.createBrowserContext',{disposeOnDetach:true});const target=await command('Target.createTarget',{url:'about:blank',browserContextId:context.browserContextId});const attached=await command('Target.attachToTarget',{targetId:target.targetId,flatten:true});const browser=new SandboxBrowser(child,directory,socket,attached.sessionId,pending,next,lifetime);
   await browser.send('Page.enable');await browser.send('DOM.enable');await browser.send('Network.enable');await browser.send('Network.setBlockedURLs',{urls:['*']});await browser.send('Network.setBypassServiceWorker',{bypass:true});await browser.send('Emulation.setScriptExecutionDisabled',{value:true});await browser.send('Emulation.setDeviceMetricsOverride',{width:640,height:480,deviceScaleFactor:1,mobile:false});await command('Browser.setDownloadBehavior',{behavior:'deny',browserContextId:context.browserContextId});return browser;
  }catch(error){socket?.close();child.kill('SIGKILL');clearTimeout(lifetime);await rm(directory,{recursive:true,force:true});throw error;}
 }
 async loadSuppliedHtml(html:string):Promise<{htmlDigest:string;networkBlocked:true;scriptsDisabled:true}>{if(Buffer.byteLength(html)>65536)throw new CapabilityInputError('SANDBOX_HTML_LIMIT');const tree=await this.send('Page.getFrameTree');const csp="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; frame-src 'none'; base-uri 'none'\">";await this.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:csp+html});return {htmlDigest:sha256(html),networkBlocked:true,scriptsDisabled:true};}
 async snapshot():Promise<{elements:Array<{nodeId:number;backendNodeId:number;name:string;text:string;attributes:Record<string,string>}>;documentDigest:string}>{
  const {root}=await this.send('DOM.getDocument',{depth:-1,pierce:false});const elements:Array<{nodeId:number;backendNodeId:number;name:string;text:string;attributes:Record<string,string>}>=[];let count=0;
  const attributesOf=(node:any)=>{const attributes:Record<string,string>={};for(let index=0;index<(node.attributes??[]).length;index+=2){const name=String(node.attributes[index]).toLowerCase();if(['id','name','type','href','value'].includes(name))attributes[name]=String(node.attributes[index+1]);}if(attributes.type)attributes.type=attributes.type.toLowerCase();return attributes;};
  const sensitive=(attributes:Record<string,string>)=>['password','hidden'].includes(attributes.type??'')||/password|secret|token|api[-_]?key/iu.test((attributes.name??'')+' '+(attributes.id??''));
  const excluded=new Set(['SCRIPT','STYLE','META','IFRAME','OBJECT','EMBED']);
  const textContent=(node:any,depth=0):string=>{if(depth>128)throw new CapabilityInputError('SANDBOX_DOM_DEPTH_LIMIT');if(excluded.has(node.nodeName)||sensitive(attributesOf(node)))return '';return node.nodeName==='#text'?String(node.nodeValue??''):(node.children??[]).map((child:any)=>textContent(child,depth+1)).join(' ');};
  const walk=(node:any,depth=0)=>{if(++count>1000||depth>128)throw new CapabilityInputError('SANDBOX_DOM_LIMIT');if(excluded.has(node.nodeName))return;const attributes=attributesOf(node),redacted=sensitive(attributes);if(redacted){delete attributes.value;attributes.type='password';}
   const text=redacted?'':['H1','H2','TITLE','BUTTON','A'].includes(node.nodeName)?textContent(node).slice(0,4096):typeof node.nodeValue==='string'?node.nodeValue.slice(0,4096):'';
   if(text||['INPUT','TEXTAREA','SELECT','BUTTON','FORM','A','H1','H2','TITLE'].includes(node.nodeName))elements.push({nodeId:node.nodeId,backendNodeId:node.backendNodeId,name:node.nodeName,text,attributes});
   if(!redacted)for(const child of node.children??[])walk(child,depth+1);
  };walk(root);return {elements,documentDigest:sha256(JSON.stringify(elements))};
 }
 async prepareField(backendNodeId:number,value:string):Promise<void>{
  if(!Number.isSafeInteger(backendNodeId)||backendNodeId<1||value.length>2048)throw new CapabilityInputError('INVALID_SANDBOX_FIELD');
  // Frontend nodeIds are session handles and can change after getDocument or
  // screenshot redaction. Eligibility and identity come from the current DOM.
  const state=await this.snapshot(),field=state.elements.find(x=>x.backendNodeId===backendNodeId&&x.name==='INPUT');
  if(!field||!['text','email','number',''].includes(field.attributes.type??'')||/password|secret|token|api[-_]?key/iu.test((field.attributes.name??'')+' '+(field.attributes.id??'')))throw new Error('SANDBOX_SENSITIVE_OR_EFFECTFUL_FIELD_DENIED');
  const nodeId=await resolveFrontendNode(this.send.bind(this),backendNodeId);await this.send('DOM.setAttributeValue',{nodeId,name:'value',value});
 }
 async screenshot():Promise<{pngBase64:string;digest:string}>{
  const sensitive=(await this.snapshot()).elements.filter(e=>e.attributes.type==='password').map(e=>e.backendNodeId);
  for(const backendNodeId of sensitive){const current=await this.snapshot();if(!current.elements.some(e=>e.backendNodeId===backendNodeId&&e.attributes.type==='password'))throw new CapabilityInputError('STALE_SANDBOX_FIELD');
   const nodeId=await resolveFrontendNode(this.send.bind(this),backendNodeId);await this.send('DOM.setOuterHTML',{nodeId,outerHTML:'<input type="password" disabled aria-label="Redacted sensitive field">'});
  }
  const captured=await this.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});if(typeof captured.data!=='string'||captured.data.length>1000000)throw new Error('SANDBOX_SCREENSHOT_LIMIT');return {pngBase64:captured.data,digest:sha256(Buffer.from(captured.data,'base64'))};
 }
 async submit():Promise<never>{throw new Error('SANDBOX_SUBMISSION_PROHIBITED');}
 async close():Promise<void>{for(const wait of this.pending.values()){clearTimeout(wait.timer);wait.reject(new Error('SANDBOX_BROWSER_CLOSED'));}this.pending.clear();this.socket.close();this.process.kill('SIGKILL');clearTimeout(this.lifetime);if(this.process.exitCode===null&&this.process.signalCode===null)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,1000);this.process.once('exit',()=>{clearTimeout(timer);resolve();});});await rm(this.directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
