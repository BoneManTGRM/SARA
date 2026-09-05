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
export {protectedTests} from './v7-protected-test-source.ts';
import {protectedTests} from './v7-protected-test-source.ts';
export const assertionCount=77;
export const baseline:ProgramCandidateProposal={schemaVersion:1,candidateKind:'typescript_program',programName:'Stable priority queue',summary:'Frozen V7 live output-format comparison',limitations:[],files:[
  {path:'src/index.ts',content:'export {enqueue,take,cancel} from "./queue.ts";\n'},
  {path:'src/queue.ts',content:broken},{path:'tests/queue.test.ts',content:protectedTests},
]};
export const reference=structuredClone(baseline);reference.files[1].content=good;
