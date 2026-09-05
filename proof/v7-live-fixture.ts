import type { ProgramCandidateProposal } from '../src/types.ts';

export const objective = 'Repair a stable bounded priority queue without changing exported APIs or mutating caller data.';
export const acceptanceCriteria = [
  'Task is {id:string,priority:number}. IDs must match /^[a-z][a-z0-9-]{0,31}$/; priorities must be integers between -10 and 10 inclusive. All queue IDs must be unique. Invalid task data or duplicate IDs throw RangeError.',
  'enqueue validates the entire queue and new task, and appends one fresh task to a fresh queue preserving arrival order. Duplicate new IDs throw RangeError.',
  'take accepts integer limit from 0 through 100 inclusive, returns {selected,remaining}, selects at most limit tasks by greatest priority first, preserving arrival order within ties. Remaining tasks preserve original arrival order.',
  'cancel validates the queue and all requested IDs, removes matching IDs, ignores unknown or repeated valid IDs, and preserves remaining order. Invalid IDs throw even for an empty queue.',
  'Every output task is a fresh object. No operation mutates caller arrays or task objects. Every operation validates even when it could otherwise return early.',
  'Keep src/index.ts and src/queue.ts. No dependencies, clocks, networking, filesystem, dynamic code or computed property access. Use for-of, ordinary properties or array methods instead of indexed array access.',
];
export const good = `export type Task = { id: string; priority: number };
function validateId(id: string): void {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) throw new RangeError("invalid id");
}
function validate(queue: readonly Task[]): void {
  const seen = new Set<string>();
  for (const task of queue) {
    validateId(task.id);
    if (!Number.isInteger(task.priority) || task.priority < -10 || task.priority > 10 || seen.has(task.id)) {
      throw new RangeError("invalid task");
    }
    seen.add(task.id);
  }
}
function copy(task: Task): Task { return {id:task.id,priority:task.priority}; }
export function enqueue(queue: readonly Task[], task: Task): Task[] {
  validate([...queue,task]);
  return [...queue,task].map(copy);
}
export function take(queue: readonly Task[], limit: number): {selected:Task[];remaining:Task[]} {
  validate(queue);
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new RangeError("invalid limit");
  const ranked = queue.map((task,index)=>({task,index}));
  ranked.sort((a,b)=>b.task.priority-a.task.priority || a.index-b.index);
  const selected = ranked.slice(0,limit).map(item=>copy(item.task));
  const ids = new Set(selected.map(task=>task.id));
  const remaining = queue.filter(task=>!ids.has(task.id)).map(copy);
  return {selected,remaining};
}
export function cancel(queue: readonly Task[], ids: readonly string[]): Task[] {
  validate(queue);
  ids.forEach(validateId);
  const removed = new Set(ids);
  return queue.filter(task=>!removed.has(task.id)).map(copy);
}
`;
export const mutations = [
  {find:'return [...queue,task].map(copy);', replace:'return [task,...queue].map(copy);'},
  {find:'b.task.priority-a.task.priority', replace:'a.task.priority-b.task.priority'},
  {find:'a.index-b.index', replace:'b.index-a.index'},
  {find:'ranked.slice(0,limit)', replace:'ranked.slice(0,limit+1)'},
  {find:'task=>!ids.has(task.id)', replace:'task=>ids.has(task.id)'},
  {find:'task=>!removed.has(task.id)', replace:'task=>removed.has(task.id)'},
];
export const broken = mutations.reduce((text,m)=>text.replace(m.find,m.replace),good);
type Task = {id:string;priority:number};
// Independent oracle selects one maximum by scanning at a time; no rank-sort/slice implementation.
function oracleTake(queue: Task[], limit: number) {
  const pool = queue.map(task=>({...task}));
  const selected:Task[]=[];
  while (selected.length<limit && pool.length) {
    let index=0;
    for(let i=1;i<pool.length;i++) if(pool[i].priority>pool[index].priority) index=i;
    selected.push(pool.splice(index,1)[0]);
  }
  return {selected,remaining:pool};
}
const queues:Task[][] = [[],[{id:'a',priority:0}],
  [{id:'a',priority:0},{id:'b',priority:0},{id:'c',priority:0}],
  [{id:'a',priority:-3},{id:'b',priority:10},{id:'c',priority:2},{id:'d',priority:10}],
  [{id:'a',priority:-10},{id:'b',priority:-2},{id:'c',priority:-5}],
];
const checks:string[]=[];
for(const queue of queues) {
  for(const limit of [0,1,2,100]) checks.push(`eq(take(${JSON.stringify(queue)},${limit}),${JSON.stringify(oracleTake(queue,limit))});`);
  const incoming={id:'new-task',priority:3};
  checks.push(`eq(enqueue(${JSON.stringify(queue)},${JSON.stringify(incoming)}),${JSON.stringify(queue.concat(incoming))});`);
  for(const ids of [[],['a'],['b','b','missing'],queue.map(t=>t.id)]) {
    const remaining:Task[]=[];
    for(const task of queue) {let remove=false;for(const id of ids) if(id===task.id) remove=true;if(!remove) remaining.push(task);}
    checks.push(`eq(cancel(${JSON.stringify(queue)},${JSON.stringify(ids)}),${JSON.stringify(remaining)});`);
  }
}
for(const invalid of ["[{id:'a',priority:11}]","[{id:'a',priority:-11}]","[{id:'a',priority:0.5}]","[{id:'a',priority:NaN}]","[{id:'A',priority:0}]","[{id:'',priority:0}]","[{id:'a',priority:1},{id:'a',priority:2}]"]) {
  for(const call of [`enqueue(${invalid},{id:'new',priority:0})`,`take(${invalid},0)`,`cancel(${invalid},[])`]) checks.push(`throws(()=>${call},RangeError);`);
}
for(const invalid of ['-1','101','0.5','NaN','Infinity']) checks.push(`throws(()=>take([],${invalid}),RangeError);`);
checks.push(`throws(()=>enqueue([{id:'a',priority:0}],{id:'a',priority:2}),RangeError);`);
for(const id of ['', 'UPPER', 'x'.repeat(33)]) checks.push(`throws(()=>cancel([], [${JSON.stringify(id)}]),RangeError);`);
checks.push(`const caller=[{id:'a',priority:0},{id:'b',priority:2}]; const fresh={id:'c',priority:1}; const queued=enqueue(caller,fresh); const chosen=take(caller,1); const cancelled=cancel(caller,[]); queued.forEach(t=>{t.priority=8;}); chosen.selected.forEach(t=>{t.priority=8;}); chosen.remaining.forEach(t=>{t.priority=8;}); cancelled.forEach(t=>{t.priority=8;}); eq(caller,[{id:'a',priority:0},{id:'b',priority:2}]); eq(fresh,{id:'c',priority:1});`);
export const assertionCount=checks.length+1;
export const protectedTests='import {enqueue,take,cancel} from "../src/index.ts";\nimport {deepStrictEqual as eq,throws} from "node:assert/strict";\n// PRIVATE_V7_QUEUE_ORACLE\n'+checks.join('\n')+'\n';
export const baseline:ProgramCandidateProposal={schemaVersion:1,candidateKind:'typescript_program',programName:'Stable priority queue',summary:'Frozen V7 live output-format comparison',limitations:[],files:[
  {path:'src/index.ts',content:'export {enqueue,take,cancel} from "./queue.ts";\n'},
  {path:'src/queue.ts',content:broken},{path:'tests/queue.test.ts',content:protectedTests},
]};
export const reference=structuredClone(baseline);reference.files[1].content=good;
