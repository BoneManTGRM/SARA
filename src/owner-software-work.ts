import type {Json} from './digital-capabilities/schema.ts';

export type SoftwareTarget={website:string;repository:string;journey:string;scope:'INSPECTION'|'JOURNEY_TEST'};
export type SoftwareContext={target:SoftwareTarget;requestId:string;receivedAt:string};
const nicoWebsite='https://nicos-world.com/';
const nicoRepository='BoneManTGRM/Nicos-Adventures';
export function requestsSoftwareInspection(text:string):boolean{
 const action=/\b(?:test|check|verify|exercise|inspect|walk through)\b/iu.test(text);
 const target=/https?:\/\/|\b(?:repository|website|site|Nico[’']?s World|same project|this project|that project)\b/iu.test(text);
 const journey=/\b(?:journey|path|flow|movement|scanner)\b/iu.test(text);
 return action&&target&&(journey||/\b(?:source|tests|repository|website)\b/iu.test(text));
}
export function resolveSoftwareTarget(text:string,prior?:SoftwareContext):{target:SoftwareTarget|null;missing:string[];contextSource:string|null}{
 // This bounded interpreter cannot safely reconcile a requested action with a
 // prohibition. Keep the request unexecuted rather than treating negated verbs
 // as permission to inspect or run the browser profile.
 const negatedAction=/\b(?:do\s+not|must\s+not|should\s+not|don[’']t|never|without|not)\s+(?:(?:actually|ever|yet|also|currently)\s+){0,2}(?:test(?:ing)?|run(?:ning)?|execut(?:e|ing)|exercis(?:e|ing)|inspect(?:ing)?|check(?:ing)?|verify(?:ing)?|fetch(?:ing)?|gather(?:ing)?|brows(?:e|ing))\b/iu.test(text);
 if(negatedAction)return {target:null,missing:['The request contains a negated software action. Clarify the permitted inspection or execution scope; nothing was dispatched.'],contextSource:null};
 const urls=[...text.matchAll(/https?:\/\/[^\s<>"“”`]+/giu)].map(m=>m[0].replace(/[.,;)]*$/u,''));
 const repositories=[...new Set([...text.matchAll(/(?:https:\/\/github\.com\/)?\b([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)\b/gu)].map(m=>m[1]!).filter(r=>!r.includes('.')||!urls.some(url=>url.includes(r)&&!url.startsWith('https://github.com/'))))];
 // Parse URLs independently; never turn a URL host/path into repository authority.
 const repoNames=repositories.filter(r=>!urls.some(url=>!url.startsWith('https://github.com/')&&url.includes(r)));
 const websites:string[]=[];const missing:string[]=[];
 for(const raw of urls){try{const url=new URL(raw);if(url.username||url.password||url.protocol!=='https:'||url.search||url.hash||url.port)throw new Error();
   if(url.hostname==='github.com'){const repo=url.pathname.replace(/^\/|\/$/gu,'');if(!repoNames.includes(repo))repoNames.push(repo);}
   else websites.push(url.href);
  }catch{missing.push('Use an HTTPS target without credentials, query parameters, custom ports or fragments.');}}
 const namedNico=/\bNico[’']?s World\b/iu.test(text);
 if(namedNico){if(repoNames.length&&repoNames.some(r=>r.toLowerCase()!==nicoRepository.toLowerCase()))missing.push('The named Nico’s World project conflicts with the supplied repository.');if(websites.length&&websites.some(w=>w!==nicoWebsite))missing.push('The named Nico’s World project conflicts with the supplied website.');}
 if(new Set(repoNames).size>1||new Set(websites).size>1)missing.push('Choose one repository and website for this bounded request.');
 const explicit=repoNames.length>0||websites.length>0||namedNico;
 const usePrior=!explicit&&/\b(?:same|this|that) project\b/iu.test(text)&&prior;
 let repository=repoNames[0]??(namedNico?nicoRepository:usePrior?prior.target.repository:'');
 let website=websites[0]??(namedNico?nicoWebsite:usePrior?prior.target.website:'');
 if(repository.toLowerCase()===nicoRepository.toLowerCase()){repository=nicoRepository;if(!website)website=nicoWebsite;}
 if(website===nicoWebsite&&!repository)repository=nicoRepository;
 if(!repository)missing.push('Identify the authorized repository. No unrelated previous project was selected.');
 const scope=/\b(?:test|exercise|verify|walk through|check)\b/iu.test(text)&&/\b(?:journey|path|flow|movement|scanner)\b/iu.test(text)?'JOURNEY_TEST':'INSPECTION';
 const specifiedMovement=/\bmovement\b/iu.test(text)&&/\bscanner\b/iu.test(text);
 if(specifiedMovement&&scope==='JOURNEY_TEST'){
  const movementIndex=text.search(/\bmovement\b/iu),scannerIndex=text.search(/\bscanner\b/iu);
  const scannerAfterMovement=/\bscanner\b\s+(?:test\s+)?after\s+(?:the\s+)?movement\b/iu.test(text);
  const reverseOrder=/\bscanner\b\s*(?:[-→]+\s*)?(?:to|before|then|through)\s*[-→]*\s*(?:the\s+)?movement\b|\bmovement\b\s+(?:test\s+)?after\s+(?:the\s+)?scanner\b/iu.test(text);
  if(reverseOrder||scannerIndex<movementIndex&&!scannerAfterMovement)missing.push('The requested journey order does not establish movement before scanner. The reviewed movement-to-scanner profile was not substituted.');
 }
 const journey=specifiedMovement?'movement-to-scanner':usePrior?prior.target.journey:'';
 if(scope==='JOURNEY_TEST'&&(website!==nicoWebsite||repository!==nicoRepository||journey!=='movement-to-scanner'))missing.push('The currently reviewed browser journey is Nico’s World movement-to-scanner. This target or journey needs its own bounded execution profile; no different test was substituted.');
 if(missing.length)return {target:null,missing,contextSource:null};
 return {target:{website,repository,journey,scope},missing:[],contextSource:usePrior?prior.requestId:null};
}
export function softwareTargetInput(target:SoftwareTarget):Json{return {...target};}
