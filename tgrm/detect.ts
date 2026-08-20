import type { Constraint, Fault } from "./types";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function termsFor(c: Constraint): string[] {
  const raw = [c.body, ...c.aliases]
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function hasTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  const re = new RegExp(`\\b${escapeRe(t)}\\b`, "i");
  return re.test(text);
}

export function findSpan(text: string, term: string): string {
  const t = term.trim();
  if (!t) return "";
  const re = new RegExp(`\\b${escapeRe(t)}\\b`, "i");
  const m = text.match(re);
  return m?.[0] ?? t;
}

export function detectFaults(text: string, constraints: Constraint[]): Fault[] {
  const faults: Fault[] = [];
  for (const c of constraints) {
    if (!c.active) continue;
    const terms = termsFor(c);
    if (c.kind === "must_not") {
      for (const term of terms) {
        if (hasTerm(text, term)) {
          faults.push({
            type: "must_not",
            ruleId: c.id,
            ruleBody: c.body,
            span: findSpan(text, term),
            note: `Banned term “${term}” is present.`,
          });
        }
      }
    } else if (c.kind === "must_include") {
      const ok = terms.some((term) => hasTerm(text, term));
      if (!ok) {
        faults.push({
          type: "must_include",
          ruleId: c.id,
          ruleBody: c.body,
          span: "",
          note: `Required “${c.body}” is missing.`,
        });
      }
    } else if (c.kind === "keep_fact") {
      const ok = terms.some((term) => text.toLowerCase().includes(term.toLowerCase()));
      if (!ok) {
        faults.push({
          type: "keep_fact",
          ruleId: c.id,
          ruleBody: c.body,
          span: "",
          note: `Kept fact “${c.body}” dropped.`,
        });
      }
    }
  }
  return faults;
}

export function constraintScore(text: string, constraints: Constraint[]) {
  const active = constraints.filter((c) => c.active);
  if (active.length === 0) return { total: 0, holding: 0 };
  const faults = detectFaults(text, active);
  const broken = new Set(faults.map((f) => f.ruleId));
  const holding = active.filter((c) => !broken.has(c.id)).length;
  return { total: active.length, holding };
}
