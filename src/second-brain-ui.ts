/** Composes into the existing owner dashboard; keeps its authentication and legacy controls. */
export function secondBrainWorkspace(html:string):string {
 const panel=String.raw`<section id="second-brain" aria-labelledby="brain-title">
 <p>PROJECT MEMORY / OWNER WORKSPACE</p><h1 id="brain-title">SARA second brain</h1>
 <p>Capture what matters. Check the source. Continue with evidence.</p>
 <p id="brain-mode">Local search · Jev disabled · no provider spending authorized</p>
 <p id="brain-status" role="status" aria-live="polite">Use Owner access to unlock your project memory.</p>
 <fieldset id="brain-fields" disabled>
 <label for="brain-project">Project</label><select id="brain-project"><option value="nico">NICO</option><option value="sara">SARA</option><option value="nicos-world">Nico’s World</option></select>
 <form id="brain-capture"><label for="brain-note">Capture a note</label><textarea id="brain-note" maxlength="8000" required placeholder="A decision, blocker, goal, or next step. Never paste credentials."></textarea>
 <label for="brain-kind">Note category</label><select id="brain-kind"><option value="note">Note</option><option value="goal">Goal</option><option value="decision">Decision</option><option value="blocker">Blocker</option><option value="constraint">Constraint</option><option value="next_action">Proposed next action</option><option value="approval">Pending approval</option></select>
 <label for="brain-source">Source link (optional; saving does not fetch it)</label><input id="brain-source" type="url" placeholder="https://github.com/…">
 <label for="brain-observed">Observed at (optional, UTC)</label><input id="brain-observed" type="text" placeholder="2026-09-26T12:00:00Z">
 <button type="submit">Save note</button></form>
 <form id="brain-search"><label for="brain-question">Find evidence or ask about project state</label><input id="brain-question" maxlength="300" type="search" placeholder="What blocks compiler qualification?"><button type="submit">Search and build brief</button></form>
 <details><summary>Import public GitHub evidence</summary><p>Read-only, owner-triggered. The selected project determines the repository. No private GitHub access is inherited from this chat.</p>
 <form id="brain-import"><label for="brain-import-kind">Evidence type</label><select id="brain-import-kind"><option value="commit">Commit</option><option value="pull_request">Pull request</option><option value="workflow_run">Workflow run</option></select>
 <label for="brain-import-id">Full commit SHA or numeric PR/run ID</label><input id="brain-import-id" required maxlength="40"><label for="brain-attempt">Run attempt (workflow only)</label><input id="brain-attempt" type="number" min="1" max="10000"><button type="submit">Fetch public evidence</button></form></details>
 <details><summary>Jev connection and existing allowance</summary>
 <p>Jev uses only public source records and a query you approve. Suggestions remain in shadow until qualified; ordinary search stays available.</p>
 <button id="brain-budget-review" type="button">Review unused job allowance</button><pre id="brain-budget"></pre><button id="brain-budget-approve" type="button" disabled>Reallocate reviewed unused allowance</button>
 <p>Provider setup: an existing TypeSafe key must be saved as TYPESAFE_API_KEY in SARA’s server environment. Never paste it into a note.</p>
 <label><input id="brain-query-public" type="checkbox">I approve sending this search query and matching public project evidence to TypeSafe.</label>
 <button id="brain-jev" type="button">Evaluate with Jev</button><pre id="brain-jev-result"></pre></details>
 <h2>Current brief</h2><textarea id="brain-handoff" readonly rows="14" aria-label="Continuation brief"></textarea>
 <button id="brain-copy" type="button">Copy handoff</button> <button id="brain-export" type="button">Export handoff</button>
 <h2>Sources and freshness</h2><div id="brain-sources"></div>
 <details><summary>History and conflicts</summary><pre id="brain-history"></pre></details>
 <details><summary>Existing obligations and runtime</summary><pre id="brain-obligations">Load after authentication.</pre></details>
 </fieldset></section><details id="brain-legacy"><summary>Legacy operations, audit and protected controls</summary>`;
 const css=String.raw`<style>
 #second-brain{max-width:960px;margin:30px auto;padding:24px;border:1px solid #45e9ff66;border-radius:16px;background:#07101e;color:#eefbff;overflow-wrap:anywhere}
 #second-brain h1{font-size:clamp(30px,6vw,52px);line-height:1.1;margin:12px 0} #second-brain h2{font-size:22px;margin:22px 0 12px}
 #second-brain fieldset{border:0;padding:0;min-width:0}#second-brain form{margin:18px 0;padding:16px;border:1px solid #8da9bc55;border-radius:10px}
 #second-brain label{display:block;margin:12px 0 6px}#second-brain input,#second-brain textarea,#second-brain select{box-sizing:border-box;display:block;width:100%;max-width:100%;font:inherit;font-size:16px;padding:12px;background:#101c2d;color:#eefbff;border:1px solid #8da9bc;border-radius:6px}
 #second-brain textarea{resize:vertical;min-height:110px}#second-brain button{min-height:44px;margin-top:12px;padding:10px 16px;white-space:normal}#second-brain summary,#brain-legacy>summary{cursor:pointer;min-height:44px;padding:12px}
 #second-brain pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}#second-brain a{color:#45e9ff}#second-brain details{margin-top:12px}#brain-legacy{margin:20px 0}
 @media(max-width:600px){#second-brain{margin:12px 0;padding:14px}#second-brain form{padding:10px}#second-brain button{width:100%}}
 </style>`;
 const script=String.raw`<script>
 (()=>{const el=id=>document.getElementById(id);let epoch=0;let allocation=null;
 const status=text=>{el('brain-status').textContent=text;};
 const clear=()=>{epoch++;el('brain-handoff').value='';el('brain-sources').replaceChildren();el('brain-history').textContent='';el('brain-obligations').textContent='';el('brain-jev-result').textContent='';el('brain-budget').textContent='';el('brain-query-public').checked=false;allocation=null;el('brain-budget-approve').disabled=true;};
 async function api(path,body){const headers={Authorization:'Bearer '+(sessionStorage.getItem('sara-owner-token')||'')};if(body)headers['content-type']='application/json';const r=await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,cache:'no-store'});if(!r.ok){if(r.status===401){clear();el('brain-fields').disabled=true;}throw new Error(r.status===401?'Owner authentication required.':'Request failed; no successful refresh is claimed.');}return r.json();}
 async function refresh(){const ticket=++epoch;const project=el('brain-project').value;const view=await api('/api/second-brain/brief?project='+encodeURIComponent(project)+'&q='+encodeURIComponent(el('brain-question').value));if(ticket!==epoch||project!==el('brain-project').value)return;
 el('brain-handoff').value=view.handoff;el('brain-sources').replaceChildren();for(const m of view.records){const d=document.createElement('details');const s=document.createElement('summary');s.textContent=m.projectEvidence.verification+' · '+m.statement.slice(0,95);d.append(s);const p=document.createElement('pre');p.textContent=JSON.stringify(m,null,2);d.append(p);if(m.source.startsWith('https://')){const a=document.createElement('a');a.href=m.source;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open source';d.append(a);}el('brain-sources').append(d);}
 el('brain-history').textContent=JSON.stringify({conflicts:view.conflicts,history:view.history},null,2);status('As of '+view.asOf+' · '+view.totalRecords+' records · '+view.conflicts.length+' conflicting records. Local deterministic search; unknowns remain unknown.');}
 const run=fn=>async e=>{if(e)e.preventDefault();try{await fn();}catch(_){status('Request failed or interrupted. Existing records are preserved; retry to reconcile.');}};
 el('brain-capture').addEventListener('submit',run(async()=>{const p=el('brain-project').value;const submitted=el('brain-note').value;await api('/api/second-brain/notes',{project:p,text:submitted,kind:el('brain-kind').value,source:el('brain-source').value,observedAt:el('brain-observed').value});if(el('brain-project').value===p&&el('brain-note').value===submitted)el('brain-note').value='';await refresh();}));
 el('brain-search').addEventListener('submit',run(refresh));el('brain-project').addEventListener('change',run(async()=>{clear();await refresh();}));
 el('brain-import').addEventListener('submit',run(async()=>{const kind=el('brain-import-kind').value;const v=await api('/api/second-brain/import',{project:el('brain-project').value,kind,id:el('brain-import-id').value,attempt:el('brain-attempt').value?Number(el('brain-attempt').value):undefined});await refresh();status(v.message||'Imported bounded source evidence. This does not prove full repository acceptance.');}));
 el('brain-budget-review').addEventListener('click',run(async()=>{const ticket=epoch;const reviewed=await api('/api/second-brain/jev/reallocation');if(ticket!==epoch)return;allocation=reviewed;el('brain-budget').textContent=JSON.stringify(reviewed,null,2);el('brain-budget-approve').disabled=Boolean(reviewed.blockers&&reviewed.blockers.length)||!(reviewed.transferableUsd>0);}));
 el('brain-budget-approve').addEventListener('click',run(async()=>{if(!allocation)return;const approved=allocation;el('brain-budget-approve').disabled=true;const result=await api('/api/second-brain/jev/reallocation',{targetId:approved.targetId,confirm:true});allocation=null;el('brain-budget').textContent=JSON.stringify(result,null,2);status('Reviewed allowance reassigned. Provider setup and live qualification are separate.');}));
 el('brain-jev').addEventListener('click',run(async()=>{if(!el('brain-query-public').checked){status('Approve disclosure of this public query before calling Jev.');return;}const ticket=epoch;const result=await api('/api/second-brain/jev/evaluate',{project:el('brain-project').value,query:el('brain-question').value,approvePublicQuery:true});if(ticket!==epoch)return;el('brain-jev-result').textContent=JSON.stringify(result,null,2);status('Jev mode: '+result.mode+' · '+result.reason+'. Suggestions do not change evidence or authorization.');}));
 el('brain-copy').addEventListener('click',run(async()=>{try{await navigator.clipboard.writeText(el('brain-handoff').value);status('Handoff copied.');}catch(_){el('brain-handoff').focus();el('brain-handoff').select();status('Select and copy the highlighted handoff using your phone’s copy menu.');}}));
 el('brain-export').addEventListener('click',()=>{const u=URL.createObjectURL(new Blob([el('brain-handoff').value],{type:'text/plain'}));const a=document.createElement('a');a.href=u;a.download='SARA-'+el('brain-project').value+'-handoff.txt';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});
 let connected=false;new MutationObserver(()=>{const next=document.body.dataset.owner==='connected';if(next===connected)return;connected=next;el('brain-fields').disabled=!next;if(!next){clear();status('Owner authentication required.');return;}run(async()=>{await refresh();const authEpoch=epoch;const data=await api('/api/second-brain/status');if(authEpoch!==epoch||document.body.dataset.owner!=='connected')return;el('brain-mode').textContent=data.providerMode;el('brain-obligations').textContent=JSON.stringify({obligations:data.obligations,recentImports:data.recentImports},null,2);})();}).observe(document.body,{attributes:true,attributeFilter:['data-owner']});
 })();</script>`;
 return html.replace(/(<main[^>]*>)/,`$1${panel}`).replace('</main>','</details></main>').replace('</head>',css+'</head>').replace('</body>',script+'</body>');
}
