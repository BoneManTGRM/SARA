import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import vm from "node:vm";

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is required");
const sourceCommit = (process.env.SARA_BENCHMARK_COMMIT_SHA ?? "").trim().toLowerCase();
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error("SARA_BENCHMARK_COMMIT_SHA must be an exact 40-character commit SHA");

const model = "gpt-5.6-luna";
const maxPhysicalCalls = 5;
let physicalCalls = 0;
let physicalInputTokens = 0;
let physicalOutputTokens = 0;

const objective = "Repair retryDelayMs so it safely parses Retry-After values into a bounded delay in milliseconds.";
const criteria = [
  "Trim surrounding whitespace.",
  "A non-negative numeric value means seconds and returns milliseconds, capped at maxMs.",
  "An HTTP-date value returns max(0, date-nowMs), capped at maxMs.",
  "Empty, malformed, non-finite, or negative values return null.",
  "Do not throw for ordinary string input.",
];
const baseline = `export function retryDelayMs(value, nowMs, maxMs) {\n  return null;\n}\n`;
const hiddenCases = [
  ["2", 1_700_000_000_000, 10_000, 2_000],
  [" 1.5 ", 1_700_000_000_000, 10_000, 1_500],
  ["999", 1_700_000_000_000, 3_000, 3_000],
  ["-1", 1_700_000_000_000, 10_000, null],
  ["", 1_700_000_000_000, 10_000, null],
  ["junk", 1_700_000_000_000, 10_000, null],
  ["Infinity", 1_700_000_000_000, 10_000, null],
  [new Date(1_700_000_005_000).toUTCString(), 1_700_000_000_000, 10_000, 5_000],
  [new Date(1_699_999_995_000).toUTCString(), 1_700_000_000_000, 10_000, 0],
  [new Date(1_700_000_050_000).toUTCString(), 1_700_000_000_000, 4_000, 4_000],
];

const digest = (value) => createHash("sha256").update(value).digest("hex");

function evaluate(source) {
  const stripped = source.replace(/export\s+/gu, "");
  let passedCount = 0;
  const failureCodes = [];
  for (let i = 0; i < hiddenCases.length; i += 1) {
    const [value, nowMs, maxMs, expected] = hiddenCases[i];
    let actual;
    try {
      const context = vm.createContext(Object.create(null), {
        codeGeneration: { strings: false, wasm: false },
      });
      const script = new vm.Script(`${stripped}\nretryDelayMs(${JSON.stringify(value)}, ${nowMs}, ${maxMs})`, {
        filename: "candidate.js",
      });
      actual = script.runInContext(context, { timeout: 50 });
    } catch {
      actual = Symbol("failure");
    }
    if (Object.is(actual, expected)) passedCount += 1;
    else failureCodes.push(i < 3 ? "NUMERIC_PATH" : i < 7 ? "INVALID_INPUT_PATH" : "HTTP_DATE_PATH");
  }
  return {
    passed: passedCount === hiddenCases.length,
    score: passedCount / hiddenCases.length,
    passedCount,
    total: hiddenCases.length,
    failureCodes: [...new Set(failureCodes)],
    digest: digest(source),
  };
}

function outputText(json) {
  const chunks = [];
  for (const item of json.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

function extractSource(text) {
  let candidate = text.trim();
  const fence = candidate.match(/```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```/iu);
  if (fence) candidate = fence[1].trim();
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed.source === "string") candidate = parsed.source;
  } catch {}
  if (!candidate.includes("retryDelayMs")) throw new Error("Model response did not contain retryDelayMs source");
  return candidate.endsWith("\n") ? candidate : `${candidate}\n`;
}

async function callLuna(prompt) {
  if (physicalCalls >= maxPhysicalCalls) throw new Error("Physical call ceiling reached");
  physicalCalls += 1;
  const started = performance.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "medium" },
      input: prompt,
      max_output_tokens: 1800,
      store: false,
    }),
  });
  const elapsedMs = performance.now() - started;
  const json = await response.json();
  if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}`);
  const inputTokens = json.usage?.input_tokens ?? 0;
  const outputTokens = json.usage?.output_tokens ?? 0;
  physicalInputTokens += inputTokens;
  physicalOutputTokens += outputTokens;
  return { source: extractSource(outputText(json)), elapsedMs, inputTokens, outputTokens };
}

function neutralPrompt(source, verification, cycle) {
  return [
    "You are repairing one small JavaScript function.", objective,
    "Public acceptance criteria:", ...criteria.map((x, i) => `${i + 1}. ${x}`),
    `Cycle: ${cycle}/3`,
    `Current aggregate verification: ${verification.passedCount}/${verification.total}; failure classes: ${verification.failureCodes.join(", ") || "none"}.`,
    cycle === 1 ? "For this first matched proposal, make only the smallest high-confidence correction; do not attempt a broad rewrite." : "Continue toward full verified completion.",
    "Return only JSON with one field named source containing the complete replacement function source. Do not include tests.",
    "Current source:", source,
  ].join("\n");
}
const controlPrompt = (source, verification, cycle) => neutralPrompt(source, verification, cycle) + "\nUse the latest state directly. Do not rely on hidden test details because none are provided.";

function tacticSignals(before, after) {
  const signals = [];
  for (const name of ["Number", "Number.isFinite", "Date.parse", "Math.min", "Math.max", "trim"]) {
    if (!before.includes(name) && after.includes(name)) signals.push(`added:${name}`);
  }
  return signals;
}
function canaryPrompt(source, verification, cycle, lessons) {
  return neutralPrompt(source, verification, cycle) + "\nReparodynamic guidance:\n" + JSON.stringify({
    preserveChampion: true,
    unresolvedFailureClasses: verification.failureCodes,
    recentLessons: lessons.slice(-2),
    instruction: "Preserve verified gains. Avoid repeating a no-gain tactic family. Prefer the smallest materially different repair that addresses unresolved failure classes.",
  });
}

const baselineVerification = evaluate(baseline);
const shared = await callLuna(neutralPrompt(baseline, baselineVerification, 1));
const sharedVerification = evaluate(shared.source);

async function controlArm() {
  let source = shared.source;
  let verification = sharedVerification;
  let elapsedMs = shared.elapsedMs;
  let inputTokens = shared.inputTokens;
  let outputTokens = shared.outputTokens;
  let calls = 1;
  for (let cycle = 2; cycle <= 3 && !verification.passed; cycle += 1) {
    const r = await callLuna(controlPrompt(source, verification, cycle));
    source = r.source;
    verification = evaluate(source);
    elapsedMs += r.elapsedMs;
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    calls += 1;
  }
  return { source, verification, elapsedMs, inputTokens, outputTokens, calls };
}

async function canaryArm() {
  let champion = sharedVerification.score > baselineVerification.score ? shared.source : baseline;
  let verification = sharedVerification.score > baselineVerification.score ? sharedVerification : baselineVerification;
  let elapsedMs = shared.elapsedMs;
  let inputTokens = shared.inputTokens;
  let outputTokens = shared.outputTokens;
  let calls = 1;
  const lessons = [];
  if (!sharedVerification.passed) lessons.push({ cycle: 1, scoreDelta: sharedVerification.score - baselineVerification.score, failureClasses: sharedVerification.failureCodes, tactics: tacticSignals(baseline, shared.source), outcome: sharedVerification.score > baselineVerification.score ? "retained_gain" : "rolled_back" });
  for (let cycle = 2; cycle <= 3 && !verification.passed; cycle += 1) {
    const before = champion;
    const beforeVerification = verification;
    const r = await callLuna(canaryPrompt(champion, verification, cycle, lessons));
    const nextVerification = evaluate(r.source);
    const gain = nextVerification.score - beforeVerification.score;
    const accepted = nextVerification.passed || gain > 0;
    lessons.push({ cycle, scoreDelta: gain, failureClasses: nextVerification.failureCodes, tactics: tacticSignals(before, r.source), outcome: nextVerification.passed ? "verified_complete" : accepted ? "retained_gain" : "rolled_back" });
    if (accepted) { champion = r.source; verification = nextVerification; }
    elapsedMs += r.elapsedMs;
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    calls += 1;
  }
  return { source: champion, verification, elapsedMs, inputTokens, outputTokens, calls, lessons };
}

const control = await controlArm();
const canary = await canaryArm();
const bothVerified = control.verification.passed && canary.verification.passed;
const speedRatio = bothVerified && canary.elapsedMs > 0 ? control.elapsedMs / canary.elapsedMs : null;
const speedIncreasePercent = speedRatio === null ? null : (speedRatio - 1) * 100;
console.log(JSON.stringify({
  schemaVersion: 2,
  evidenceLevel: "LIVE_SINGLE_MATCHED_CODING_SPEED_TRACE",
  sourceCommit,
  model,
  objectiveDigest: digest(objective + JSON.stringify(criteria)),
  sharedFirstProposalDigest: digest(shared.source),
  baseline: baselineVerification,
  control: { verifiedComplete: control.verification.passed, score: control.verification.score, activeModelMilliseconds: Math.round(control.elapsedMs), logicalModelCalls: control.calls, inputTokens: control.inputTokens, outputTokens: control.outputTokens, finalSourceDigest: digest(control.source) },
  canary: { verifiedComplete: canary.verification.passed, score: canary.verification.score, activeModelMilliseconds: Math.round(canary.elapsedMs), logicalModelCalls: canary.calls, inputTokens: canary.inputTokens, outputTokens: canary.outputTokens, finalSourceDigest: digest(canary.source), lessons: canary.lessons },
  physicalModelCalls: physicalCalls,
  physicalInputTokens,
  physicalOutputTokens,
  timeComparable: bothVerified,
  speedRatio,
  speedIncreasePercent,
  accuracyPreserved: canary.verification.score >= control.verification.score,
  target200PercentMet: speedIncreasePercent !== null && speedIncreasePercent >= 200 && canary.verification.score >= control.verification.score,
  generalClaimSupported: false,
}, null, 2));
