// Existing V7 fixtures for verifier parity, not model evaluation.
type Fixture = { id: string; objective: string; source: string; find: string; correct: string; wrong: string[]; assertions: string[] };
export const compilerFixtures: Fixture[] = [
  { id: "clamp", objective: "Clamp finite numbers to the inclusive range zero through ten.",
    source: "export function run(n: number): number {\n  return Math.min(20, Math.max(0, n));\n}\n",
    find: "20,", correct: "10,", wrong: ["12,", "14,", "16,"],
    assertions: [-3,0,1,9,10,11,12,20].map(n => `eq(run(${n}),${n < 0 ? 0 : n > 10 ? 10 : n});`) },
  { id: "inclusive-count", objective: "Count the integers in inclusive integer endpoints start <= end.",
    source: "export function run(start: number, end: number): number {\n  return end - start;\n}\n",
    find: "return end - start;", correct: "return end - start + 1;",
    wrong: ["return end - start + 2;", "return end - start + 3;", "return end - start + 4;"],
    assertions: [[0,0],[1,1],[0,1],[-3,4],[-9,-2],[4,14]].map(([a,b]) => {
      const points = Array.from({length: b-a+1}, (_,i)=>a+i); return `eq(run(${a},${b}),${points.length});`; }) },
  { id: "batch-count", objective: "Return the number of batches needed for n nonnegative integer items and positive integer capacity.",
    source: "export function run(n: number, capacity: number): number {\n  return Math.floor(n / capacity);\n}\n",
    find: "Math.floor(n / capacity)", correct: "Math.ceil(n / capacity)",
    wrong: ["Math.round(n / capacity)", "Math.ceil(n / capacity) + 1", "Math.floor(n / capacity) + 2"],
    assertions: [[0,3],[1,3],[3,3],[4,3],[8,5],[19,7],[21,7]].map(([n,c]) => {
      let expected = 0; for(let remaining=n;remaining>0;remaining-=c) expected++;
      return `eq(run(${n},${c}),${expected});`; }) },
  { id: "run-length", objective: "Run-length encode consecutive identical Unicode characters without merging separated runs.",
    source: 'export function run(text: string): Array<{value:string;count:number}> {\n  const out: Array<{value:string;count:number}> = [];\n  let active: {value:string;count:number} | undefined;\n  for (const value of text) {\n    if (active && active.value === value) active.count += 2;\n    else { active = {value, count:1}; out.push(active); }\n  }\n  return out;\n}\n',
    find: "active.count += 2", correct: "active.count += 1", wrong: ["active.count += 3", "active.count += 4", "active.count += 5"],
    assertions: ["","a","aa","abbccc","abab","xxxyyxx","ééa"].map(text => {
      const expected = [...text.matchAll(/(.)\1*/gsu)].map(m=>({value:[...m[0]][0],count:[...m[0]].length}));
      return `eq(run(${JSON.stringify(text)}),${JSON.stringify(expected)});`; }) },
  { id: "csv-quote", objective: "Always wrap a CSV cell in double quotes and escape every embedded quote by doubling it.",
    source: `export function run(value: string): string {\n  return '"' + value.replace('"', '""') + '"';\n}\n`,
    find: `value.replace('"', '""')`, correct: `value.replaceAll('"', '""')`,
    wrong: [`value.replaceAll('"', '')`, `value.replaceAll('"', '"""')`, `value.replaceAll('"', '""""')`],
    assertions: ["","abc",'a"b"c','""','a,b','a\nb'].map(text => {
      let expected='"'; for(const char of text) expected += char==='"'?'""':char; expected+='"';
      return `eq(run(${JSON.stringify(text)}),${JSON.stringify(expected)});`; }) },
  { id: "canonical-tags", objective: "Trim, lowercase, deduplicate and lexically sort nonempty tags without mutating input.",
    source: 'export function run(values: readonly string[]): string[] {\n  const normalized = values.map(v=>v.trim().toLowerCase()).filter(v=>v.length>0);\n  return normalized.sort();\n}\n',
    find: "return normalized.sort();", correct: "return [...new Set(normalized)].sort();",
    wrong: ["return normalized.sort().reverse();", "return normalized.slice(1).sort();", "return normalized.slice(0, 1).sort();"],
    assertions: [[" A ","a","B","b"],[],["z","x","x"],["", "  ","k"],["Q","q","p","q"]].map(values => {
      const out: string[]=[]; for(const value of values) {const v=value.trim().toLowerCase(); if(v && !out.includes(v)) out.push(v);}
      return `eq(run(${JSON.stringify(values)}),${JSON.stringify(out.sort())});`; }) },
];
