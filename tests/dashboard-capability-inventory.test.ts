import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {createContext,Script} from 'node:vm';
import {sha256} from '../src/canonical.ts';
import {SaraKernel} from '../src/kernel.ts';
import {createSaraServer} from '../src/server.ts';
import {DASHBOARD_HTML} from '../src/dashboard.ts';

// Execute the served owner script and its real HTTP reads. The DOM stand-in only
// supplies elements; it does not implement capability counting or fetching.
test('owner dashboard renders the current digital registry independently of legacy revenue capabilities',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sara-dashboard-inventory-'));
 const token='synthetic-dashboard-owner';
 const kernel=await SaraKernel.boot({stateDirectory:directory,ownerTokenSha256:sha256(token),bootstrapRevenueCapabilities:true});
 const server=createSaraServer(kernel,{ownerTokenSha256:sha256(token),stateDirectory:directory});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const html=await (await fetch(base)).text();
  assert.equal(html,DASHBOARD_HTML,'The HTTP route must serve the exact reviewed dashboard source');
  const nodes=new Map<string,any>();
  const node=(selector:string):any=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'—',dataset:{},style:{},classList:{add(){},remove(){}},addEventListener(){},replaceChildren(){},querySelector:node});return nodes.get(selector);};
  const storage=new Map<string,string>();let contractReads=0,override:Response|undefined;
  const context=createContext({AbortSignal,crypto:globalThis.crypto,document:{body:node('body'),querySelector:node},sessionStorage:{getItem:(key:string)=>storage.get(key)??null,removeItem:(key:string)=>storage.delete(key)},window:{},fetch:async(path:string,options?:RequestInit)=>{
   if(path==='/api/capability-contracts'){contractReads++;if(override)return override.clone();}
   return fetch(base+path,options);
  }});
  // Execute only the authored module after checking HTTP delivery equality.
  // This is an exact source delimiter, not an HTML parser or sanitizer.
  const start=DASHBOARD_HTML.indexOf('<script>');
  const end=DASHBOARD_HTML.indexOf('</script>',start);
  assert.ok(start>=0&&end>start);
  const script=DASHBOARD_HTML.slice(start+'<script>'.length,end);
  new Script(script).runInContext(context);
  assert.equal(contractReads,0,'Locked dashboard must not request protected inventory');
  // Other panels have their own tests; retain the actual authentication, HTTP,
  // inventory rendering and owner-state loader from the served script.
  new Script('renderMutations = () => {}; renderCommerce = () => {}; renderAutonomy = () => {}; refreshLearning = async () => {};').runInContext(context);
  storage.set('sara-owner-token',token);
  const refresh=()=>new Script('loadPrivateState()').runInContext(context) as Promise<void>;
  await refresh();
  const contracts=await kernel.inspectCapabilityContracts();
  const legacy=(await kernel.getStatus()).capabilities.length;
  assert.equal(legacy,4);assert.equal(contracts.length,98);
  assert.equal(node('#capabilities').textContent,String(contracts.filter(c=>c.status==='ENABLED'&&c.maturity==='QUALIFIED'&&c.qualification.status==='PASSED').length));
  assert.equal(contractReads,1);
  assert.match(node('#capabilities-note').textContent,/98 registered/);
  assert.match(node('#capabilities-note').textContent,/4 revenue services/);
  assert.match(html,/Digital capabilities/);

  override=Response.json([contracts[0],{...contracts[1],status:'QUARANTINED'},{...contracts[2],status:'SHADOW'},{...contracts[3],qualification:{status:'FAILED'}}]);
  await refresh();assert.equal(node('#capabilities').textContent,'1');assert.match(node('#capabilities-note').textContent,/4 registered/);
  for(const body of [{error:'malformed'},[contracts[0],contracts[0]],[{id:'missing-status'}]]){
   override=Response.json(body);await refresh();assert.equal(node('#capabilities').textContent,'—');assert.match(node('#capabilities-note').textContent,/unavailable/i);
  }
  override=new Response('unavailable',{status:503});await refresh();assert.equal(node('#capabilities').textContent,'—');
  override=Response.json([]);await refresh();assert.equal(node('#capabilities').textContent,'0');
  override=undefined;await refresh();assert.equal(node('#capabilities').textContent,'98');
  new Script('setConnected(false)').runInContext(context);assert.equal(node('#capabilities').textContent,'—');
  override=new Response('unauthorized',{status:401});await assert.rejects(refresh,/Owner token/);assert.equal(node('body').dataset.owner,'locked');assert.equal(node('#capabilities').textContent,'—');
  assert.equal((await kernel.getStatus()).capabilities.length,legacy,'Presentation must not change the revenue capability state');
 } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
