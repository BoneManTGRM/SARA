import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Script,createContext} from 'node:vm';
import {setImmediate} from 'node:timers/promises';
import {secondBrainWorkspace} from '../src/second-brain-ui.ts';
import {projectView,noteInput,evidenceId} from '../src/second-brain.ts';

// Execute the actual authored workspace script. Only the DOM and transport are
// stand-ins; delayed replies exercise the real scope/authentication guards.
test('late brief/status replies cannot repopulate a changed project or logged-out workspace',async()=>{
 const nodes=new Map<string,any>();
 const node=(id:string):any=>{
  if(!nodes.has(id)){let text='';const children:any[]=[];const handlers=new Map<string,Function>();nodes.set(id,{value:id==='brain-project'?'nico':'',dataset:{},children,handlers,disabled:true,
   get textContent(){return text+children.map(x=>x.textContent??'').join('');},set textContent(v:string){text=v;children.length=0;},
   replaceChildren(...items:any[]){text='';children.splice(0,children.length,...items);},append(...items:any[]){children.push(...items);},
   addEventListener(name:string,fn:Function){handlers.set(name,fn);},focus(){}});}return nodes.get(id);
 };
 let observe=()=>{};let created=0;
 const pending:{path:string;resolve:(r:Response)=>void}[]=[];
 const body={dataset:{owner:''}};
 const script=secondBrainWorkspace('<html><head></head><body><main></main></body></html>').match(/<script>([\s\S]*)<\/script>/)![1];
 const context=createContext({document:{body,getElementById:node,querySelectorAll:()=>[],createElement:()=>node('created-'+created++)},
  Option:class {constructor(public textContent:string,public value:string){}},MutationObserver:class{constructor(fn:()=>void){observe=fn;}observe(){}},
  sessionStorage:{getItem:()=> 'synthetic-owner'},fetch:(path:string)=>new Promise<Response>(resolve=>pending.push({path,resolve})),encodeURIComponent,Map,JSON,Date,setTimeout});
 new Script(script).runInContext(context);
 assert.equal(pending.length,0,'Locked page makes no private requests');
 const now=new Date('2026-09-26T12:00:00Z');const input=noteInput({project:'nico',kind:'decision',text:'PRIVATE OLD PROJECT'},now.toISOString());
 const privateView=projectView([{...input,id:evidenceId(input)}],'nico','What was decided?',now),empty=projectView([],'sara','',now);
 const reply=(requests:typeof pending,view:unknown,status=200)=>{for(const request of requests)request.resolve(new Response(JSON.stringify(request.path.includes('/brief?')?view:{providerMode:'synthetic disabled',obligations:['synthetic obligation'],recentImports:[]}),{status:request.path.includes('/status')?status:200}));};
 body.dataset.owner='connected';observe();assert.equal(pending.length,2);const old=pending.splice(0);
 node('brain-project').value='sara';const switching=node('brain-project').handlers.get('change')();const current=pending.splice(0);
 reply(current,empty);await switching;assert.match(node('brain-obligations').textContent,/synthetic obligation/);
 reply(old,privateView);await setImmediate();assert.ok(!node('brain-answer').textContent.includes('PRIVATE'));assert.ok(!node('brain-handoff').value.includes('PRIVATE'));
 const refreshing=node('brain-search').handlers.get('submit')();const afterLogout=pending.splice(0);body.dataset.owner='';observe();reply(afterLogout,privateView);await refreshing;
 for(const id of ['brain-answer','brain-obligations','brain-tracking'])assert.equal(node(id).textContent,'');assert.equal(node('brain-handoff').value,'');assert.equal(node('brain-fields').disabled,true);
 // A failed runtime read must be visible without suppressing usable evidence.
 body.dataset.owner='connected';observe();reply(pending.splice(0),empty,503);await setImmediate();assert.match(node('brain-obligations').textContent,/refresh failed/);assert.match(node('brain-mode').textContent,/unavailable/);assert.match(node('brain-handoff').value,/SARA \/ SARA/);
 // The bounty panel uses the same actual-script scope and logout boundary.
 node('brain-project').value='sara';const loading=node('brain-bounty-load').handlers.get('click')();const bountyReply=pending.splice(0);
 body.dataset.owner='';observe();for(const request of bountyReply)request.resolve(Response.json({notice:'PRIVATE BOUNTY',asOf:now.toISOString(),candidates:[],totalCurrent:0,history:[]}));await loading;
 assert.equal(node('brain-bounties').textContent,'');assert.equal(node('brain-bounty-brief').value,'');assert.equal(node('brain-bounty-copy').disabled,true);
});
