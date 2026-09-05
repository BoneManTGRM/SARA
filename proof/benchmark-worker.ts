import {initializeWorker} from './benchmark-worker-client.ts';
try{
 if(process.env.OPENAI_API_KEY?.trim())throw Error('WORKER_PROVIDER_KEY_FORBIDDEN');
 if(process.argv.length===3&&process.argv[2]==='--idle'){
  console.log('BENCHMARK_IDLE_NO_PROVIDER_ACCESS');setInterval(()=>{},60_000);
 }else{
  if(process.argv.length!==2)throw Error('WORKER_ARGUMENTS_DENIED');
  await initializeWorker();
  process.argv.push('--bridge');
  await import('./live-v7-comparison.ts');
 }
}catch{
 // Do not disclose exception messages, source, test outputs or secrets.
 process.stderr.write('BENCHMARK_WORKER_STOPPED\n');process.stdin.destroy();process.exitCode=1;
}
