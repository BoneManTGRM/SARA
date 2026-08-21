#!/usr/bin/env node
import {
  SAMPLE_CONSTRAINTS,
  SAMPLE_TEXT,
  compareTgrm,
  hasTerm,
} from "./tgrm/index.ts";

const { on, off } = compareTgrm({
  text: SAMPLE_TEXT,
  constraints: SAMPLE_CONSTRAINTS,
});

function line(label: string, value: string) {
  console.log(`${label.padEnd(14)} ${value}`);
}

console.log("SARA  ·  TGRM on vs off  ·  sample weekend plan");
console.log("───────────────────────────────────────────────");
line("TGRM off hold", `${off.log.constraintHolding}/${off.log.constraintTotal}`);
line("coffee left?", String(hasTerm(off.text, "coffee") || hasTerm(off.text, "espresso")));
line("walk present?", String(hasTerm(off.text, "walk")));
console.log("");
line("TGRM on hold", `${on.log.constraintHolding}/${on.log.constraintTotal}`);
line("verified", String(on.log.verified && !on.log.rolledBack));
line("method", on.log.method);
line("coffee left?", String(hasTerm(on.text, "coffee") || hasTerm(on.text, "espresso")));
line("walk present?", String(hasTerm(on.text, "walk")));
line("market kept?", String(/farmers market/i.test(on.text)));
line("RYE on", on.log.rye.toFixed(2));
line("RYE off", off.log.rye.toFixed(2));
console.log("");
console.log("Patched text:");
console.log(on.text.trimEnd());

const ok =
  on.log.verified &&
  on.log.constraintHolding === on.log.constraintTotal &&
  off.log.constraintHolding < off.log.constraintTotal &&
  !hasTerm(on.text, "coffee") &&
  hasTerm(on.text, "walk");

if (!ok) {
  console.error("\nSARA demo failed: TGRM did not prove intactness on the sample.");
  process.exit(1);
}

console.log("\nProof: same text, same rules. Off is broken. On is intact.");
