import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SAMPLE_CONSTRAINTS,
  SAMPLE_TEXT,
  compareTgrm,
  constraintScore,
  detectFaults,
  hasTerm,
  repairLocal,
  runTgrm,
} from "../tgrm/index.ts";

describe("SARA TGRM — sample weekend plan", () => {
  it("detects coffee, missing walk, and keeps the market as a fact", () => {
    const faults = detectFaults(SAMPLE_TEXT, SAMPLE_CONSTRAINTS);
    const types = faults.map((f) => f.type).sort();
    assert.deepEqual(types, ["must_include", "must_not", "must_not"]);
    assert.ok(hasTerm(SAMPLE_TEXT, "espresso"));
    assert.ok(hasTerm(SAMPLE_TEXT, "coffee"));
    assert.equal(hasTerm(SAMPLE_TEXT, "walk"), false);
    assert.match(SAMPLE_TEXT, /Farmers market/i);
  });

  it("TGRM on: drops caffeine, adds a walk, keeps the market, verifies", () => {
    const { text, log } = runTgrm({
      text: SAMPLE_TEXT,
      constraints: SAMPLE_CONSTRAINTS,
      tgrmEnabled: true,
    });
    assert.equal(log.rolledBack, false);
    assert.equal(log.verified, true);
    assert.equal(log.method, "local");
    assert.equal(log.constraintHolding, log.constraintTotal);
    assert.equal(log.constraintTotal, 3);
    assert.equal(hasTerm(text, "coffee"), false);
    assert.equal(hasTerm(text, "espresso"), false);
    assert.equal(hasTerm(text, "walk"), true);
    assert.match(text, /Farmers market/i);
    assert.match(text, /Read in the park/);
  });

  it("TGRM off: leaves faults in place", () => {
    const { text, log } = runTgrm({
      text: SAMPLE_TEXT,
      constraints: SAMPLE_CONSTRAINTS,
      tgrmEnabled: false,
    });
    assert.equal(text, SAMPLE_TEXT);
    assert.equal(log.method, "none");
    assert.ok(log.constraintHolding < log.constraintTotal);
    assert.ok(hasTerm(text, "espresso"));
    assert.equal(hasTerm(text, "walk"), false);
  });

  it("compare: on holds all rules, off does not", () => {
    const { on, off } = compareTgrm({
      text: SAMPLE_TEXT,
      constraints: SAMPLE_CONSTRAINTS,
    });
    assert.equal(on.log.constraintHolding, 3);
    assert.ok(off.log.constraintHolding < 3);
    assert.ok(on.log.rye >= off.log.rye);
  });

  it("clean text needs no repair", () => {
    const clean = `Saturday\n- Farmers market\n- Take a walk.\n`;
    const { log } = runTgrm({
      text: clean,
      constraints: SAMPLE_CONSTRAINTS,
      tgrmEnabled: true,
    });
    assert.equal(log.faults.length, 0);
    assert.equal(log.method, "none");
    assert.deepEqual(constraintScore(clean, SAMPLE_CONSTRAINTS), { total: 3, holding: 3 });
  });

  it("inactive rules are ignored", () => {
    const offRules = SAMPLE_CONSTRAINTS.map((c) => ({ ...c, active: false }));
    const { log } = runTgrm({
      text: SAMPLE_TEXT,
      constraints: offRules,
      tgrmEnabled: true,
    });
    assert.equal(log.faults.length, 0);
    assert.equal(log.constraintTotal, 0);
  });

  it("repairs large uncontrolled whitespace in linear cleanup paths", () => {
    const constraint = {
      id: "include-walk",
      kind: "must_include" as const,
      body: "walk",
      aliases: [],
      active: true,
    };
    const fault = {
      type: "must_include" as const,
      ruleId: constraint.id,
      ruleBody: constraint.body,
      span: "",
      note: "Required walk is missing.",
    };
    const uncontrolled = `Plan${" \t".repeat(25_000)}x   \n\t\n\n\n`;

    const repaired = repairLocal(uncontrolled, [fault], [constraint]);

    assert.equal(repaired, "Plan" + " \t".repeat(25_000) + "x\n- Take a walk.\n");

    const prohibited = {
      id: "exclude-forbidden",
      kind: "must_not" as const,
      body: "forbidden",
      aliases: [],
      active: true,
    };
    const prohibitedFault = {
      type: "must_not" as const,
      ruleId: prohibited.id,
      ruleBody: prohibited.body,
      span: "",
      note: "Forbidden term is present.",
    };

    assert.equal(
      repairLocal("Header   \n\n\n\nBody\t \n", [prohibitedFault], [prohibited]),
      "Header\n\nBody\n",
    );
  });
});
