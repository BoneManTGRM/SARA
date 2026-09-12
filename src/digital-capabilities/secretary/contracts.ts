import { arraySchema as arr, enumSchema as en, idSchema as id, integerSchema, objectSchema as obj, textSchema as txt, type Schema } from '../schema.ts';
const nil=(schema:Schema):Schema=>({...schema,nullable:true});
export const strings=arr(txt(4096),100);
export const boolean:Schema={type:'boolean'};
export const timestamp=txt(64);
export const messageSchema=obj({id,sourceId:txt(256),sender:txt(256),sentAt:timestamp,replyTo:nil(id),body:txt(12000,0)});
export const messages=arr(messageSchema,100);
export const thread=obj({threadId:id,messages});
export const fact=obj({id:txt(128),messageId:id,sourceId:txt(256),sender:txt(256),statement:txt(12000),deadline:nil(txt(64)),confidence:en('EXPLICIT','UNCERTAIN'),provenance:en('SUPPLIED')});
export const facts=arr(fact,500);
const guards={externalActionPerformed:boolean,authorityGranted:boolean,safetyFlags:strings,limitations:strings};
export const extracted=obj({threadId:id,commitments:facts,decisions:facts,questions:facts,uncertainStatements:facts,paymentsMentioned:facts,responsibleParties:strings,nextAction:txt(512),...guards});
const priority=obj({messageId:id,category:en('SECURITY','FINANCIAL','CUSTOMER','OPERATIONAL','SCHEDULING','INFORMATIONAL','LOW_VALUE'),priority:en('REVIEW_PROMPTLY','NORMAL','LOW'),basis:strings,sourceId:txt(256),provenance:en('SUPPLIED'),authorityGranted:boolean});
const item=obj({id,category:en('URGENT','BLOCKED','CUSTOMER','FINANCIAL','OPPORTUNITY','COMMITMENT','HEALTH','DECISION'),summary:txt(2048),sourceId:txt(256),dueAt:nil(timestamp),status:en('OPEN','COMPLETE','UNKNOWN'),requiresOwner:boolean});
export const secretarySchemas:Record<string,{input:Schema;output:Schema}>={
 'email-thread-action-extractor':{input:thread,output:extracted},
 'commitment-tracker':{input:thread,output:obj({threadId:id,commitments:facts,uncertainStatements:facts,recordDigest:txt(64),persistence:en('KERNEL_INVOCATION_RECEIPT'),historyRewritten:boolean,...guards})},
 'follow-up-detector':{input:obj({threadId:id,messages,asOf:timestamp,resolutions:arr(obj({questionMessageId:id,responseMessageId:id}),100)}),output:obj({threadId:id,followUps:arr(obj({kind:en('UNANSWERED_QUESTION','COMMITMENT_DUE'),messageId:id,sourceId:txt(256),reason:txt(12000),dueAt:nil(timestamp),certainty:en('EXPLICIT','UNCERTAIN')}),500),invalidResolutions:strings,...guards})},
 'inbox-priority-classifier':{input:obj({messages}),output:obj({items:arr(priority,100),advisoryOnly:boolean,...guards})},
 'support-intake-triage':{input:obj({requestId:id,customerId:txt(256),messages}),output:obj({requestId:id,customerId:txt(256),problem:txt(12000,0),category:txt(128),urgency:en('REVIEW_PROMPTLY','NORMAL','LOW'),knownFacts:facts,missingFacts:strings,risks:strings,requiredCapabilities:strings,ownerApprovalRequirements:strings,recommendedNextAction:txt(1024),responseDraft:txt(2048),...guards})},
 'calendar-intent-parser':{input:obj({text:txt(8000),title:txt(256),participants:arr(txt(256),50)}),output:obj({title:txt(256),participants:arr(txt(256),50),date:nil(txt(10)),time:nil(txt(8)),timezone:nil(txt(64)),durationMinutes:nil(integerSchema(1,1440)),location:nil(txt(256)),notes:txt(8000),status:en('DRAFT_READY','NEEDS_CLARIFICATION'),ambiguities:strings,confidence:en('EXPLICIT_COMPONENTS','LOW'),...guards})},
 'meeting-preparation-compiler':{input:obj({meetingId:id,title:txt(256),messages,documentRefs:strings,decisionsRequired:strings}),output:obj({meetingId:id,title:txt(256),history:facts,unresolvedItems:facts,commitments:facts,documents:strings,decisionsRequired:strings,recommendedQuestions:strings,...guards})},
 'daily-owner-brief':{input:obj({asOf:timestamp,items:arr(item,100)}),output:obj({asOf:timestamp,sections:arr(obj({category:txt(32),items:arr(item,100)}),10),decisionsRequired:strings,unknownItems:strings,urgencyBasis:en('SUPPLIED_STATUS_AND_EXPLICIT_DEADLINES'),...guards})},
 'decision-register':{input:obj({decisionId:id,decision:txt(4096),scope:txt(1024),decidedAt:timestamp,evidenceRefs:strings,supersedesReceiptId:nil(id)}),output:obj({status:en('RECORDED','BLOCKED'),decisionId:id,record:nil(obj({decisionId:id,decision:txt(4096),scope:txt(1024),decidedAt:timestamp,evidenceRefs:strings,supersedesReceiptId:nil(id),authorityContextDigest:txt(64)})),recordDigest:nil(txt(64)),authoritySource:en('AUTHENTICATED_OWNER','NONE'),reason:txt(512),persistence:en('KERNEL_INVOCATION_RECEIPT'),historyRewritten:boolean,...guards})},
 'attachment-action-extractor':{input:obj({attachmentId:id,sourceId:txt(256),filename:txt(256),mimeType:txt(128),extractedText:txt(16000,0)}),output:obj({attachmentId:id,documentKind:en('INVOICE','CONTRACT','SCHEDULING','GENERAL','UNSUPPORTED'),requestedActions:facts,deadlines:strings,paymentImplications:facts,approvalNeeded:boolean,unansweredQuestions:facts,contentExecuted:boolean,sourceId:txt(256),provenance:en('SUPPLIED'),...guards})},
};
