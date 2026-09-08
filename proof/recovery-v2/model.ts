import type { RepositoryAction, RepositoryProducerModel } from '../../src/repository-producer.ts';

export interface PublicProblem { hypotheses: Record<string, unknown>[]; wholeFile: boolean; ignoreRejection?: boolean }
/** Same observation-responsive search for A/B/C. No arm, fixture identity,
 * private grading cases or controller-specific event names enter this adapter.
 * Public candidate configurations are hypotheses, not an answer key. */
export function modelFor(problem: PublicProblem): RepositoryProducerModel {
  let hypothesis = 0;
  const unchanged = new Map<string, number>();
  return { async request({prompt}) {
    const input = JSON.parse(prompt);
    const events = input.observations as {kind:string;detail:any}[];
    const last = events.filter(e => e.kind === 'action').at(-1)?.detail;
    let action: RepositoryAction;
    if (last?.action === 'finish') {
      // A rejected stop is public feedback, not a grading answer. Try the next
      // declared hypothesis if one exists; a stubborn substitute ignores it.
      const rejected = events.at(-1)?.kind === 'decision' && events.at(-1)?.detail.action === 'reject_finish';
      if (rejected && !problem.ignoreRejection) hypothesis++;
      action = rejected && !problem.ignoreRejection && problem.hypotheses[hypothesis]
        ? {action:'read',path:'src/settings.json'} : {action:'finish'};
    } else if (!last || last.action === 'edit') action = {action:'read',path:'src/settings.json'};
    else if (last.action === 'test') {
      const test = events.filter(e => e.kind === 'public_test').at(-1)!.detail;
      if (test.exitCode === 0) action = {action:'finish'};
      else { hypothesis++; action = {action:'read',path:'src/settings.json'}; }
    } else {
      const text = events.filter(e=>e.kind==='tool').at(-1)!.detail.output as string;
      const current = JSON.parse(text), target = problem.hypotheses[hypothesis];
      if (!target) action = {action:'finish'};
      else {
        const field = Object.keys(target).find(k=>JSON.stringify(target[k])!==JSON.stringify(current[k]));
        if (!field) action = {action:'test'};
        else {
          const key = JSON.stringify([hypothesis,current]);
          const tries = unchanged.get(key) ?? 0; unchanged.set(key,tries+1);
          // If an edit made no progress twice, gather actual test feedback
          // before moving to a different hypothesis. This rule is arm-blind.
          if (tries >= 2) action = {action:'test'};
          else action = {action:'edit',path:'src/settings.json',
            oldText:problem.wholeFile ? text : `${JSON.stringify(field)}: ${JSON.stringify(current[field])}`,
            newText:problem.wholeFile ? JSON.stringify(target,null,2)+'\n' : `${JSON.stringify(field)}: ${JSON.stringify(target[field])}`};
        }
      }
    }
    return {outputText:JSON.stringify(action),inputTokens:0,outputTokens:0,accountedCostUsd:0};
  }};
}
