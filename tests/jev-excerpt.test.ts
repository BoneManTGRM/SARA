import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {jevExcerpt} from '../src/jev-excerpt.ts';

test('frozen 100-case placement diagnostic retains target evidence without synthesis',async()=>{
 const f=JSON.parse(await readFile(new URL('./fixtures/jev-excerpt-placement.v1.json',import.meta.url),'utf8'));
 let count=0,retained=0,headOnly=0;
 for(const topic of f.conditions.topics)for(const position of f.conditions.positions){
  const target=f.targetTemplate.replace('{topic}',topic);
  const padding=f.conditions.padding.repeat(Math.ceil(f.conditions.sourceLength/f.conditions.padding.length));
  const source=padding.slice(0,position)+target+padding.slice(position+target.length,f.conditions.sourceLength);
  const result=jevExcerpt(source,topic);count++;
  retained+=Number(result.text.includes(target));headOnly+=Number(source.slice(0,1500).includes(target));
  assert.equal(result.text,source.slice(result.excerptStart,result.excerptEnd));assert.ok(result.text.length<=1500);
  assert.equal(result.originalLength,source.length);assert.equal(result.excerptTruncated,true);
 }
 assert.equal(count,100);assert.ok(retained/100>=f.expected.minimumExactTargetRetention);assert.ok(retained>=headOnly);
});
test('short text is unchanged; no-match defaults to head; offsets preserve Unicode',()=>{
 assert.deepEqual(jevExcerpt('No deployment approval.','approval').text,'No deployment approval.');
 const source='🧠'.repeat(1400)+'révision aprobada: no es permiso de despliegue.'+'🧠'.repeat(1400);
 const r=jevExcerpt(source,'révision aprobada');assert.match(r.text,/no es permiso/);
 assert.equal(r.text,source.slice(r.excerptStart,r.excerptEnd));assert.equal(Buffer.from(r.text,'utf8').toString('utf8'),r.text);
 const noMatch=jevExcerpt(source,'unmatched');assert.equal(noMatch.excerptStart,0);assert.equal(Buffer.from(noMatch.text,'utf8').toString('utf8'),noMatch.text);
 assert.throws(()=>jevExcerpt('x'.repeat(32001),'x'),/Invalid/);
});
test('word repetition has no extra weight and negative context remains verbatim',()=>{
 const source=('compiler '.repeat(250))+' Archive. '.repeat(100)+'Compiler timeout did NOT pass qualification.'+' Archive. '.repeat(100);
 const r=jevExcerpt(source,'compiler timeout');assert.match(r.text,/Compiler timeout did NOT pass qualification/);
 assert.equal(r.text,source.slice(r.excerptStart,r.excerptEnd));
});
