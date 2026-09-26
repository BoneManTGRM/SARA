/** Deterministic, contiguous source windows; no generated summaries or truth judgments. */
export const JEV_EXCERPT_VERSION='source-window-v1';
export const JEV_EXCERPT_LIMIT=1500;
export const JEV_SOURCE_TEXT_LIMIT=32000;
const terms=(text:string)=>text.match(/[\p{L}\p{N}]+/gu)?.map(t=>t.toLowerCase())??[];
const lowSurrogate=(text:string,index:number)=>{const code=text.charCodeAt(index);return code>=0xdc00&&code<=0xdfff;};
export function jevExcerpt(text:string,query:string) {
 if(typeof text!=='string'||text.length>JEV_SOURCE_TEXT_LIMIT||typeof query!=='string'||query.length>1000)throw new Error('Invalid excerpt input.');
 const requested=new Set(terms(query).slice(0,24));
 const starts=new Set<number>([0]);
 // Overlapping windows prevent a late mention from being invisible. The bound
 // is independent of keyword repetition, and repeated keywords earn no bonus.
 for(let start=750;start<text.length;start+=750)starts.add(start);
 let best={start:0,end:Math.min(text.length,JEV_EXCERPT_LIMIT),score:-1};
 for(const offset of starts){
  let start=Math.min(offset,Math.max(0,text.length-JEV_EXCERPT_LIMIT));
  if(lowSurrogate(text,start))start++;
  let end=Math.min(text.length,start+JEV_EXCERPT_LIMIT);
  if(end<text.length&&lowSurrogate(text,end))end--;
  const visible=new Set(terms(text.slice(start,end)));
  const score=[...requested].filter(t=>visible.has(t)).length;
  if(score>best.score)best={start,end,score};
 }
 return {text:text.slice(best.start,best.end),excerptStart:best.start,excerptEnd:best.end,
  originalLength:text.length,excerptTruncated:best.start>0||best.end<text.length,
  excerptVersion:JEV_EXCERPT_VERSION,offsetUnit:'utf16_code_units' as const};
}
