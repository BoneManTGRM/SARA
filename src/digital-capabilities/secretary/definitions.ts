import type { CapabilityDefinition } from '../types.ts';
import { secretarySchemas } from './contracts.ts';
import { secretaryCases } from './qualification.ts';
import { attachment, brief, calendar, followUps, inbox, intake, meeting, registerDecision, threadActions, trackCommitments } from './operations.ts';
const implementations:Record<string,{execute:CapabilityDefinition['execute'];description:string;draft?:boolean;state?:boolean;owner?:boolean}>={
 'support-intake-triage':{execute:intake,description:'Structure supplied support requests with missing scope, risks, required capabilities and a noncommittal response draft.',draft:true},
 'email-thread-action-extractor':{execute:threadActions,description:'Extract explicit English commitments, questions, stated decisions, payment mentions and uncertainty with message provenance.'},
 'commitment-tracker':{execute:trackCommitments,description:'Persist explicit sourced commitment snapshots in the existing immutable kernel invocation receipt chain.',state:true},
 'follow-up-detector':{execute:followUps,description:'Identify unanswered questions and due date commitments from supplied threads; never send follow-up.'},
 'calendar-intent-parser':{execute:calendar,description:'Parse explicit calendar components and preserve missing or ambiguous dates, timezones and duration; produce a draft only.',draft:true},
 'meeting-preparation-compiler':{execute:meeting,description:'Compile supplied history, unresolved questions, commitments and document references for meeting preparation.',draft:true},
 'daily-owner-brief':{execute:brief,description:'Group supplied open work by topic and explicit deadlines, preserving unknowns and owner decisions without fabricated urgency.',draft:true},
 'decision-register':{execute:registerDecision,description:'Record an authenticated owner decision as an immutable kernel receipt with exact scope and trusted earlier decision supersession; grants no external authority.',state:true,owner:true},
 'inbox-priority-classifier':{execute:inbox,description:'Classify supplied communication routing signals with advisory priority and explicit uncertainty; scheduling authority is unchanged.'},
 'attachment-action-extractor':{execute:attachment,description:'Inspect bounded caller-extracted attachment text for requested actions, obligations and dates without executing binary content, scripts or macros.'},
};
export const secretaryDefinitions:readonly CapabilityDefinition[]=Object.entries(implementations).map(([id,x])=>({id,version:'1.0.0',description:x.description,inputSchema:secretarySchemas[id]!.input,outputSchema:secretarySchemas[id]!.output,effect:x.state?'INTERNAL_STATE':x.draft?'DRAFT_ONLY':'PURE',authorityClass:x.owner?'CONSEQUENTIAL_REQUIRES_OWNER':x.draft?'DRAFT_ONLY':'READ_ONLY',...(x.owner?{ownerOnly:true}:{}),resources:['supplied-input','actor-visible-kernel-evidence-receipts'],sourceFiles:['secretary/contracts.ts','secretary/operations.ts','secretary/qualification.ts','secretary/definitions.ts'],qualificationRequirements:['frozen-contract','malformed-input','conditional-commitment-uncertainty','source-provenance','no-external-effect','prompt-injection-boundary','determinism',...(x.state?['kernel-replay-and-recovery','audit-history-preservation']:[])],execute:x.execute,cases:secretaryCases[id]!}));
