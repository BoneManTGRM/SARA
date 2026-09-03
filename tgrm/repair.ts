import { termsFor, hasTerm } from "./detect";
import type { Constraint, Fault } from "./types";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineHasTerm(line: string, terms: string[]) {
  return terms.some((t) => hasTerm(line, t));
}

function includeLine(body: string) {
  const t = body.trim();
  if (!t) return "";
  if (t.split(/\s+/).length > 2 || /^[A-Z]/.test(t) || /[.!?]$/.test(t)) {
    return `\n- ${t}`;
  }
  return `\n- Take a ${t}.`;
}

function collapseNewlineRuns(text: string): string {
  const chunks: string[] = [];
  let newlineRun = 0;

  for (const character of text) {
    if (character === "\n") {
      newlineRun += 1;
      if (newlineRun <= 2) chunks.push(character);
      continue;
    }

    newlineRun = 0;
    chunks.push(character);
  }

  return chunks.join("");
}

function stripHorizontalWhitespaceBeforeNewlines(text: string): string {
  const chunks: string[] = [];
  let pendingWhitespace = "";

  for (const character of text) {
    if (character === " " || character === "\t") {
      pendingWhitespace += character;
      continue;
    }

    if (character !== "\n") chunks.push(pendingWhitespace);
    pendingWhitespace = "";
    chunks.push(character);
  }

  chunks.push(pendingWhitespace);
  return chunks.join("");
}

/** Smallest useful local patch. Never regenerates the whole text. */
export function repairLocal(text: string, faults: Fault[], constraints: Constraint[]): string {
  if (faults.length === 0) return text;
  const byId = new Map(constraints.map((c) => [c.id, c]));
  let next = text.replace(/\r\n/g, "\n");

  const mustNot = faults.filter((f) => f.type === "must_not");
  if (mustNot.length) {
    const terms = new Set<string>();
    for (const f of mustNot) {
      const c = byId.get(f.ruleId);
      if (c) for (const t of termsFor(c)) terms.add(t);
      if (f.span) terms.add(f.span);
    }
    const list = [...terms];
    next = next
      .split("\n")
      .filter((line) => !line.trim() || !lineHasTerm(line, list))
      .join("\n");
    for (const t of list) {
      if (!hasTerm(next, t)) continue;
      const re = new RegExp(`\\b${escapeRe(t)}\\b`, "gi");
      next = next.replace(re, "").replace(/[ ]{2,}/g, " ");
    }
  }

  const missingInclude = faults.filter((f) => f.type === "must_include");
  for (const f of missingInclude) {
    const c = byId.get(f.ruleId);
    const body = (c?.body ?? f.ruleBody).trim();
    if (!body) continue;
    if (hasTerm(next, body) || (c && termsFor(c).some((t) => hasTerm(next, t)))) continue;
    next = `${next.trimEnd()}${includeLine(body)}`;
  }

  const missingKeep = faults.filter((f) => f.type === "keep_fact");
  for (const f of missingKeep) {
    const body = f.ruleBody.trim();
    if (!body) continue;
    if (next.toLowerCase().includes(body.toLowerCase())) continue;
    next = `- ${body}\n${next.trimStart()}`;
  }

  next = stripHorizontalWhitespaceBeforeNewlines(collapseNewlineRuns(next));
  if (text.endsWith("\n") && !next.endsWith("\n")) next += "\n";
  return next;
}
