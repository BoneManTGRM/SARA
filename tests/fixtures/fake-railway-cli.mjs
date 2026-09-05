// Substitute only the external Railway transport. The launched worker and supervisor are real.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
assert.deepEqual(process.argv.slice(2),['ssh','--project',uuid,'--environment',uuid,'--service',uuid,'--deployment-instance',uuid,'--','node','--import','tsx','proof/benchmark-worker.ts']);
assert.equal(process.env.OPENAI_API_KEY,undefined);
const child=spawn(process.execPath,['--import','tsx','proof/benchmark-worker.ts'],{stdio:'inherit',env:{PATH:process.env.PATH,RAILWAY_DEPLOYMENT_ID:uuid,RAILWAY_GIT_COMMIT_SHA:'b'.repeat(40)}});
child.once('error',()=>{process.exitCode=1;});child.once('close',code=>{process.exitCode=code??1;});
