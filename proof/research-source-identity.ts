import {execFileSync} from 'node:child_process';
/** The workflow event SHA may be a synthetic merge ref, not the checkout. */
export function researchSourceIdentity(cwd=process.cwd(),expected?:string):string {
 let head:string;
 try{head=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim();}
 catch{throw Error('SOURCE_IDENTITY_UNAVAILABLE');}
 if(!/^[a-f0-9]{40}$/u.test(head))throw Error('SOURCE_IDENTITY_UNAVAILABLE');
 if(expected!==undefined&&expected!==head)throw Error('SOURCE_IDENTITY_MISMATCH');
 return head;
}
