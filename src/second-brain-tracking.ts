import type {EvidenceMemory} from './second-brain.ts';
/** Read-only projection over canonical, already project-scoped evidence. No model or action surface. */
export function projectTracking(all:readonly EvidenceMemory[],current:readonly EvidenceMemory[],conflicts:ReadonlySet<string>,superseded:ReadonlySet<string>,now:Date,since:string|null) {
 const byId=new Map(all.map(m=>[m.id,m]));
 const state=(m:EvidenceMemory)=>superseded.has(m.id)?'superseded':m.projectEvidence.expiresAt&&Date.parse(m.projectEvidence.expiresAt)<=now.getTime()?'stale':(m.status??'active')!=='active'?'inactive':conflicts.has(m.id)?'conflict':'current';
 const reference=(m:EvidenceMemory)=>({id:m.id,source:m.source,kind:m.projectEvidence.kind,verification:m.projectEvidence.verification,observedAt:m.projectEvidence.observedAt,ingestedAt:m.projectEvidence.ingestedAt,lastVerifiedAt:m.projectEvidence.lastVerifiedAt,state:state(m)});
 const item=(m:EvidenceMemory)=>({...reference(m),text:m.statement.slice(0,500),excerptTruncated:m.statement.length>500,authorization:'not_established' as const,
  observedBeforeWindow:since!==null&&m.projectEvidence.observedAt!==null&&Date.parse(m.projectEvidence.observedAt)<=Date.parse(since),
  related:[...new Set([...(m.dependencies??[]),...(m.supersedes??[]),...m.projectEvidence.conflictsWith])].filter(id=>byId.has(id)).slice(0,36).map(id=>({...reference(byId.get(id)!),relationship:m.supersedes?.includes(id)?'supersedes':m.projectEvidence.conflictsWith.includes(id)?'conflicts_with':'related'})),
 });
 const ordered=(records:readonly EvidenceMemory[])=>[...records].sort((a,b)=>(b.projectEvidence.observedAt??'').localeCompare(a.projectEvidence.observedAt??'')||a.id.localeCompare(b.id));
 const group=(records:readonly EvidenceMemory[])=>({total:records.length,omitted:Math.max(0,records.length-20),items:records.slice(0,20).map(item)});
 const kind=(name:string)=>group(ordered(current.filter(m=>m.projectEvidence.kind===name)));
 const changed=since===null?[]:all.filter(m=>Date.parse(m.projectEvidence.ingestedAt)>Date.parse(since)&&Date.parse(m.projectEvidence.ingestedAt)<=now.getTime()).sort((a,b)=>b.projectEvidence.ingestedAt.localeCompare(a.projectEvidence.ingestedAt)||a.id.localeCompare(b.id));
 return {decisions:kind('decision'),blockers:kind('blocker'),nextActions:kind('next_action'),pendingApprovals:kind('approval'),changes:{...group(changed),since,asOf:now.toISOString(),basis:'ingestion_time' as const,notice:'Records saved in this interval; older observations may arrive late. This does not establish external changes, resolution, verification or permission.'}};
}
