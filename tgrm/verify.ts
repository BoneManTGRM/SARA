import { constraintScore, detectFaults } from "./detect";
import type { Constraint } from "./types";

const RETAIN_FLOOR = 0.55;

export function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((w) => w.length > 2),
  );
}

export function retainRatio(before: string, after: string): number {
  const a = wordSet(before);
  if (a.size === 0) return after.trim() ? 0 : 1;
  const b = wordSet(after);
  let hit = 0;
  for (const w of a) if (b.has(w)) hit += 1;
  return hit / a.size;
}

export function verifyRepair(before: string, after: string, constraints: Constraint[]) {
  const faults = detectFaults(after, constraints);
  const score = constraintScore(after, constraints);
  const retain = retainRatio(before, after);
  const rewrite = retain < RETAIN_FLOOR && before.trim().length > 40;
  const verified = faults.length === 0 && !rewrite;
  const notes: string[] = [];
  if (faults.length) notes.push(`${faults.length} constraint${faults.length === 1 ? "" : "s"} still broken.`);
  if (rewrite) notes.push(`Patch looked like a rewrite (retain ${(retain * 100).toFixed(0)}%). Rolled back.`);
  return { verified, faults, score, retain, notes };
}
