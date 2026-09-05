import {initializeWorker} from './benchmark-worker-client.ts';
import {loadV8SupervisedContract} from './v8-supervised-contract.ts';
try{
 if(process.argv.length!==2||process.env.OPENAI_API_KEY?.trim())throw Error('WORKER_ARGUMENTS_OR_CREDENTIAL');
 await initializeWorker(loadV8SupervisedContract);
 process.argv.push('--bridge');
 await import('./live-v8-comparison.ts');
}catch{process.stderr.write('V8_WORKER_STOPPED\n');process.stdin.destroy();process.exitCode=1;}
