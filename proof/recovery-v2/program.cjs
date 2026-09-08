// Fixed toy application and assertion runner. This is executed in a child
// process against actual files. Private cases are provided only after freeze.
const fs=require('fs');
const c=JSON.parse(fs.readFileSync('src/settings.json','utf8'));
const family=process.argv[2],cases=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
function compute(x){
 if(family==='affine')return c.a*x+c.b;
 if(family==='clamp')return Math.max(c.lo,Math.min(c.hi,x));
 if(family==='discount')return Math.round(x*(1-c.rate))+c.fee;
 if(family==='sum')return c.a+c.b+c.c;
 if(family==='identity')return c.mode;
 throw Error('UNKNOWN_TOY_FAMILY');
}
const outcomes=cases.map(([input,expected])=>{const actual=compute(input);return {input,actual,expected,passed:Array.isArray(expected)?expected.includes(actual):actual===expected};});
console.log(JSON.stringify(outcomes));process.exitCode=outcomes.every(x=>x.passed)?0:1;
