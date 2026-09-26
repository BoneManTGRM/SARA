import type {EvidenceMemory} from './second-brain.ts';
export type QuestionKind='decision'|'blocker'|'next_action'|'approval';
const questions:Readonly<Record<QuestionKind,readonly string[]>>={
 decision:['what was decided','what did we decide','what decisions were made','show decisions'],
 blocker:['what is blocked','what remains blocked','what are the blockers','show blockers'],
 next_action:['what is next','what should we do next','what is the next authorized step','show next steps'],
 approval:['what needs approval','which approvals are pending','show pending approvals'],
};
/** Whole-question aliases only. Compound, topical and instruction-bearing queries keep ordinary search. */
export function questionKind(query:string):QuestionKind|null {
 const normalized=query.toLowerCase().trim().replace(/what['’]s\b/gu,'what is').replace(/[?!.]+$/u,'').replace(/\s+/gu,' ').trim();
 return (Object.keys(questions) as QuestionKind[]).find(kind=>questions[kind].includes(normalized))??null;
}
/** Inputs are already authorized, scoped, current and ordered by source observation in projectView. */
export function projectAnswer(kind:QuestionKind|null,records:readonly EvidenceMemory[],conflicts:ReadonlySet<string>,asOf:string){
 if(!kind)return null;
 const titles:Record<QuestionKind,string>={decision:'Reported decisions',blocker:'Reported blockers',next_action:'Proposed next steps',approval:'Pending approval requests'};
 const notices:Record<QuestionKind,string>={decision:'Saved decisions are reported claims, not independently verified facts.',blocker:'Saved blockers are reported claims. Whether they are resolved is unknown unless supported by a current correction.',next_action:'These are saved proposals. The next authorized action is unknown; this answer grants no permission.',approval:'These are saved requests. Approval is not granted by a note or by this answer.'};
 const conflictCount=records.filter(m=>conflicts.has(m.id)).length;
 return {version:'guided-project-v1' as const,kind,title:titles[kind],asOf,basis:'saved_record_categories' as const,
  status:!records.length?'unknown' as const:conflictCount?'conflict' as const:'reported' as const,
  authorization:'not_established' as const,notice:(!records.length?'Unknown — no current records in this category. ':'')+notices[kind]+(conflictCount?' Unresolved contradictions remain; inspect both sides in History and conflicts.':''),
  total:records.length,omitted:Math.max(0,records.length-10),conflictCount,
  sources:records.slice(0,10).map(m=>({id:m.id,source:m.source,excerpt:m.statement.slice(0,500),excerptTruncated:m.statement.length>500,verification:m.projectEvidence.verification,state:conflicts.has(m.id)?'conflict' as const:'current' as const,observedAt:m.projectEvidence.observedAt,lastVerifiedAt:m.projectEvidence.lastVerifiedAt})),
 };
}
