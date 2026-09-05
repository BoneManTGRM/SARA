import {createInterface} from 'node:readline';
const input=createInterface({input:process.stdin});const it=input[Symbol.asyncIterator]();
const ready=JSON.parse(process.env.TEST_READY);
const send=value=>console.log(JSON.stringify(value));send(ready);await it.next();
const mode=process.env.TEST_MODE;
const count={type:'count',id:1,arm:'compact_first',cycle:1,prompt:'public synthetic input'};
if(mode==='empty_result')send({type:'result',record:{}});
else if(mode==='duplicate_ready')send(ready);
else if(mode==='oversize')process.stdout.write('x'.repeat(1_048_577));
else if(mode==='partial')process.stdout.write('{');
else{
 send(count);await it.next();
 if(mode==='reused_id')send(count);
 else{
  const request={type:'execute',id:2,arm:'compact_first',cycle:1,prompt:count.prompt,reasoningLevel:mode==='low_reasoning'?'low':'medium',maximumOutputTokens:8000};
  send(request);if(mode==='disconnect_inflight'){setTimeout(()=>process.exit(0),100);await new Promise(()=>{});}await it.next();
 }
}
input.close();process.stdin.destroy();
