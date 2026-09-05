import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalJson,sha256} from '../src/canonical.ts';
import {protectedTests,baseline,reference,assertionCount} from '../proof/v7-live-fixture.ts';
test('static fixture preserves every original protected byte and both artifact identities',()=>{
 assert.equal(assertionCount,77);
 assert.equal(sha256(protectedTests),'5cf00d63ef6fb47f0807ef4bb073a3087171bfdb50d0c96a88102a3046453365');
 assert.equal(sha256(canonicalJson(baseline)),'2703dd83f694f9ae16a486171621beb4c8c0de1230192d49efe5a0c2f3997b40');
 assert.equal(sha256(canonicalJson(reference)),'2eb0fccbddf8d28aaad0afc44ed548bae54170589747d83a1459254a0ace2732');
});
