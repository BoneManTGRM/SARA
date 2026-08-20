import { detectFaults, constraintScore } from "./detect";
import { repairLocal } from "./repair";
import { verifyRepair } from "./verify";
import { rye } from "./rye";
import type { RepairLog, TgrmInput, TgrmResult } from "./types";

function emptyLog(text: string): RepairLog {
  return {
    faults: [],
    before: text,
    after: text,
    verified: true,
    rolledBack: false,
    method: "none",
    tokensDetect: 0,
    tokensRepair: 0,
    rye: 1,
    yield: 1,
    energy: 1,
    notes: ["TGRM off — raw output, no patch."],
    constraintTotal: 0,
    constraintHolding: 0,
    retain: 1,
  };
}

export function runTgrm(input: TgrmInput): TgrmResult {
  const { text, constraints, tgrmEnabled } = input;
  const active = constraints.filter((c) => c.active);

  if (!tgrmEnabled) {
    const score = constraintScore(text, active);
    const y = score.total ? score.holding / score.total : 1;
    return {
      text,
      log: {
        ...emptyLog(text),
        yield: y,
        rye: rye(y, 1),
        constraintTotal: score.total,
        constraintHolding: score.holding,
        notes:
          score.total && score.holding < score.total
            ? ["TGRM off. Constraints are broken and were not repaired."]
            : ["TGRM off — raw output, no patch."],
      },
    };
  }

  const faults = detectFaults(text, active);
  const beforeScore = constraintScore(text, active);

  if (faults.length === 0) {
    return {
      text,
      log: {
        faults: [],
        before: text,
        after: text,
        verified: true,
        rolledBack: false,
        method: "none",
        tokensDetect: 0,
        tokensRepair: 0,
        rye: rye(1, 1),
        yield: 1,
        energy: 1,
        notes: ["Clean. No repair needed."],
        constraintTotal: beforeScore.total,
        constraintHolding: beforeScore.holding,
        retain: 1,
      },
    };
  }

  const patched = repairLocal(text, faults, active);
  const check = verifyRepair(text, patched, active);
  const energy = 1;
  if (!check.verified) {
    const y = beforeScore.total ? beforeScore.holding / beforeScore.total : 0;
    return {
      text,
      log: {
        faults,
        before: text,
        after: text,
        verified: false,
        rolledBack: true,
        method: "local",
        tokensDetect: 0,
        tokensRepair: 0,
        rye: rye(y, energy),
        yield: y,
        energy,
        notes: check.notes.length ? check.notes : ["Repair failed verify. Rolled back."],
        constraintTotal: beforeScore.total,
        constraintHolding: beforeScore.holding,
        retain: check.retain,
      },
    };
  }

  const y = check.score.total ? check.score.holding / check.score.total : 1;
  return {
    text: patched,
    log: {
      faults,
      before: text,
      after: patched,
      verified: true,
      rolledBack: false,
      method: "local",
      tokensDetect: 0,
      tokensRepair: 0,
      rye: rye(y, energy),
      yield: y,
      energy,
      notes: [`Patched ${faults.length} fault${faults.length === 1 ? "" : "s"} locally.`],
      constraintTotal: check.score.total,
      constraintHolding: check.score.holding,
      retain: check.retain,
    },
  };
}

export function applyModelPatch(
  before: string,
  proposed: string,
  constraints: TgrmInput["constraints"],
  tokensRepair: number,
): TgrmResult {
  const active = constraints.filter((c) => c.active);
  const faults = detectFaults(before, active);
  const check = verifyRepair(before, proposed, active);
  const energy = Math.max(tokensRepair, 1);
  if (!check.verified) {
    const score = constraintScore(before, active);
    const y = score.total ? score.holding / score.total : 0;
    return {
      text: before,
      log: {
        faults,
        before,
        after: before,
        verified: false,
        rolledBack: true,
        method: "model",
        tokensDetect: 0,
        tokensRepair,
        rye: rye(y, energy),
        yield: y,
        energy,
        notes: check.notes.length ? check.notes : ["Model patch failed verify. Rolled back."],
        constraintTotal: score.total,
        constraintHolding: score.holding,
        retain: check.retain,
      },
    };
  }
  const y = check.score.total ? check.score.holding / check.score.total : 1;
  return {
    text: proposed,
    log: {
      faults,
      before,
      after: proposed,
      verified: true,
      rolledBack: false,
      method: "model",
      tokensDetect: 0,
      tokensRepair,
      rye: rye(y, energy),
      yield: y,
      energy,
      notes: ["Model applied a surgical patch."],
      constraintTotal: check.score.total,
      constraintHolding: check.score.holding,
      retain: check.retain,
    },
  };
}
