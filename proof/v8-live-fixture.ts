import type { ProgramCandidateProposal } from '../src/types.ts';
import { protectedTests } from './v8-inventory-protected-test-source.ts';

export const objective = 'Repair a bounded immutable inventory basket without changing exported APIs or mutating caller data.';
export const acceptanceCriteria = [
  'Line is {sku:string,quantity:number,unitCents:number}. SKU must match /^[A-Z][A-Z0-9-]{0,15}$/; quantity must be an integer from 1 through 20; unitCents must be an integer from 1 through 100000. Existing SKU values must be unique. Invalid data throws RangeError.',
  'add validates the entire existing basket and the incoming line. A new SKU appends at the end. An existing SKU keeps its original position, requires the same unitCents, and adds quantity; combined quantity above 20 throws RangeError.',
  'discount validates the basket and accepts only integer percent from 0 through 50 inclusive. It returns fresh lines with unitCents equal to floor(unitCents*(100-percent)/100), but never below 1.',
  'remove validates the basket and every requested SKU, removes matching SKUs, ignores unknown and repeated valid SKUs, and preserves the remaining order.',
  'total validates the basket and returns the exact integer sum of quantity*unitCents for every line.',
  'All array-returning operations return a fresh array and fresh line objects. No operation mutates caller arrays or line objects. Keep src/index.ts and src/inventory.ts. No dependencies, clocks, networking, filesystem, or dynamic code.',
];
export const good = `export type Line = { sku: string; quantity: number; unitCents: number };
function validateSku(sku: string): void {
  if (!/^[A-Z][A-Z0-9-]{0,15}$/.test(sku)) throw new RangeError("invalid sku");
}
function validateLine(line: Line): void {
  validateSku(line.sku);
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) throw new RangeError("invalid quantity");
  if (!Number.isInteger(line.unitCents) || line.unitCents < 1 || line.unitCents > 100000) throw new RangeError("invalid price");
}
function validate(lines: readonly Line[]): void {
  const seen = new Set<string>();
  for (const line of lines) {
    validateLine(line);
    if (seen.has(line.sku)) throw new RangeError("duplicate sku");
    seen.add(line.sku);
  }
}
function copy(line: Line): Line { return {sku:line.sku,quantity:line.quantity,unitCents:line.unitCents}; }
export function add(lines: readonly Line[], line: Line): Line[] {
  validate(lines); validateLine(line);
  const existing = lines.find(item=>item.sku===line.sku);
  if (!existing) return [...lines,line].map(copy);
  if (existing.unitCents !== line.unitCents) throw new RangeError("price mismatch");
  const quantity = existing.quantity + line.quantity;
  if (quantity > 20) throw new RangeError("quantity limit");
  return lines.map(item=>item.sku===line.sku?{sku:item.sku,quantity,unitCents:item.unitCents}:copy(item));
}
export function discount(lines: readonly Line[], percent: number): Line[] {
  validate(lines);
  if (!Number.isInteger(percent) || percent < 0 || percent > 50) throw new RangeError("invalid percent");
  return lines.map(line=>({sku:line.sku,quantity:line.quantity,unitCents:Math.max(1,Math.floor(line.unitCents*(100-percent)/100))}));
}
export function remove(lines: readonly Line[], skus: readonly string[]): Line[] {
  validate(lines); skus.forEach(validateSku);
  const removed = new Set(skus);
  return lines.filter(line=>!removed.has(line.sku)).map(copy);
}
export function total(lines: readonly Line[]): number {
  validate(lines);
  return lines.reduce((sum,line)=>sum+line.quantity*line.unitCents,0);
}
`;
export const mutations = [
  {find:'return [...lines,line].map(copy);',replace:'return [line,...lines].map(copy);'},
  {find:'existing.quantity + line.quantity',replace:'existing.quantity - line.quantity'},
  {find:'Math.floor(line.unitCents*(100-percent)/100)',replace:'Math.ceil(line.unitCents*(100-percent)/100)'},
  {find:'line=>!removed.has(line.sku)',replace:'line=>removed.has(line.sku)'},
  {find:'sum+line.quantity*line.unitCents',replace:'sum+line.unitCents'},
];
export const broken = mutations.reduce((text,m)=>text.replace(m.find,m.replace),good);
export const assertionCount = (protectedTests.match(/\b(?:eq|throws|notStrictEqual)\(/g) ?? []).length;
export const baseline: ProgramCandidateProposal = {schemaVersion:1,candidateKind:'typescript_program',programName:'Bounded inventory basket',summary:'Fresh V8 live compact-first comparison',limitations:[],files:[
  {path:'src/index.ts',content:'export {add,discount,remove,total} from "./inventory.ts";\n'},
  {path:'src/inventory.ts',content:broken},
  {path:'tests/inventory.test.ts',content:protectedTests},
]};
export const reference = structuredClone(baseline); reference.files[1].content = good;
