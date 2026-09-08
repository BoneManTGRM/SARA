import type { RepositoryProducerModel, RepositoryAction } from '../../src/repository-producer.ts';
export type Policy = 'responsive' | 'imperfect' | 'unresponsive';
export interface PublicSearch { space: Record<string, unknown[]>; wholeFile: boolean; policy: Policy }
/** Enumerate a public finite search domain, then respond to observed failures.
 * No fixture identity, arm, private test, or reference repair is inspected.
 * This is bounded enumeration, not general repair discovery. */
export function modelFor(problem: PublicSearch): RepositoryProducerModel {
  let index=0, failures=0, tested=false, initialized=false;
  let targets:Record<string,unknown>[]=[];
  let attemptedFrom:string|undefined;
  function failed(){ failures++; const patience=problem.policy==='responsive'?1:problem.policy==='imperfect'?4:Infinity;
    if(failures>=patience){ index++;failures=0;tested=false; } }
  return {async request({prompt}) {
    const input=JSON.parse(prompt), events=input.observations as {kind:string;detail:any}[];
    const last=events.filter(e=>e.kind==='action').at(-1)?.detail;
    let action:RepositoryAction;
    if(!last||last.action==='edit') action={action:'read',path:'src/settings.json'};
    else if(last.action==='test'){
      const result=events.filter(e=>e.kind==='public_test').at(-1)!.detail;
      if(result.exitCode===0)action={action:'finish'};
      else {tested=true;failed();action={action:'read',path:'src/settings.json'};}
    }else if(last.action==='finish'){
      if(events.at(-1)?.detail.action==='reject_finish')failed();
      action=problem.policy==='responsive'&&targets[index]?{action:'read',path:'src/settings.json'}:{action:'finish'};
    }else{
      const text=events.filter(e=>e.kind==='tool').at(-1)!.detail.output as string;
      const current=JSON.parse(text);
      if(!initialized){
        let all:Record<string,unknown>[]=[{}];
        for(const [key,values] of Object.entries(problem.space))all=all.flatMap(base=>values.map(value=>({...base,[key]:value})));
        targets=all.filter(t=>Object.keys(t).some(k=>JSON.stringify(t[k])!==JSON.stringify(current[k])));
        initialized=true;
      }
      const unchanged=attemptedFrom===JSON.stringify(current);attemptedFrom=undefined;
      if(unchanged&&!tested){action={action:'test'};}
      else{
        if(unchanged)failed();
        const target=targets[index];
        const field=target&&Object.keys(target).find(k=>JSON.stringify(target[k])!==JSON.stringify(current[k]));
        if(!target)action={action:'finish'};
        else if(!field)action={action:'test'};
        else{attemptedFrom=JSON.stringify(current);action={action:'edit',path:'src/settings.json',
          oldText:problem.wholeFile?text:`${JSON.stringify(field)}: ${JSON.stringify(current[field])}`,
          newText:problem.wholeFile?JSON.stringify({...current,...target},null,2)+'\n':`${JSON.stringify(field)}: ${JSON.stringify(target[field])}`};}
      }
    }
    return {outputText:JSON.stringify(action),inputTokens:0,outputTokens:0,accountedCostUsd:0};
  }};
}
