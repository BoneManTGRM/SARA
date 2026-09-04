import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const API_KEY = process.env.OPENAI_API_KEY?.trim();
const MODEL = "gpt-5.6-luna";
const MAX_PHYSICAL_CALLS = 5;
const MAX_OUTPUT_TOKENS = 1800;
const MAX_WALL_MS = 120_000;

if (!API_KEY) throw new Error("OPENAI_API_KEY is required for the isolated coding-speed benchmark.");
if (process.env.SARA_RUN_CODING_SPEED_BENCHMARK !== "true") {
  throw new Error("Standalone coding-speed benchmark requires the explicit benchmark flag.");
}

let physicalModelCalls = 0;
let physicalInputTokens = 0;
let physicalOutputTokens = 0;

const objective = "Repair retryDelayMs so it safely parses an HTTP Retry-After value into a bounded delay in milliseconds.";
const acceptanceCriteria = [
  "Trim surrounding whitespace.",
  "A finite non-negative numeric value means seconds and returns milliseconds capped at maxMs.",
  "An HTTP-date value returns max(0, parsedDate-nowMs) capped at maxMs.",
  "Empty, malformed, non-finite, or negative values return null.",
  "Do not throw for ordinary string input.",
];
const baselineSource = `export function retryDelayMs(value, nowMs, maxMs) {\n  return null;\n}\n`;

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function evaluate(source) {
  let fn;
  try {
    fn = new Function(`${source.replace(/export\s+/g, "")}\nreturn retryDelayMs;`)();
  } catch {
    return {
      passed: false,
      score: 0,
      passedCount: 0,
      total: hiddenCases.length,
      failureClasses: ["SYNTAX_OR_LOAD"],
      artifactDigest: sha256(source),
    };
  }
  let passedCount = 0;
  const failureClasses = [];
  for (let i = 0; i < hiddenCases.length; i += 1) {
    const [value, nowMs, maxMs, expected] = hiddenCases[i];
    let actual;
    try {
      actual = fn(value, nowMs, maxMs);
    } catch {
      actual = Symbol("threw");
    }
    if (Object.is(actual, expected)) passedCount += 1;
    else failureClasses.push(i < 3 ? "NUMERIC_PATH" : i < 7 ? "INVALID_INPUT_PATH" : "HTTP_DATE_PATH");
  }
  return {
    passed: passedCount === hiddenCases.length,
    score: passedCount / hiddenCases.length,
    passedCount,
    total: hiddenCases.length,
    failureClasses: [...new Set(failureClasses)],
    artifactDigest: sha256(source),
  };
}

function responseText(payload) {
  return (Array.isArray(payload.output) ? payload.output : []).flatMap((item) => (
    Array.isArray(item?.content) ? item.content : []
  )).flatMap((part) => (
    part?.type === "output_text" && typeof part.text === "string" ? [part.text] : []
  )).join("\n").trim();
}

function extractSource(text) {
  let candidate = text.trim();
  const fenced = candidate.match(/```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```/i);
  if (fenced) candidate = fenced[1].trim();
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed?.source === "string") candidate = parsed.source;
  } catch {}
  if (!candidate.includes("retryDelayMs")) throw new Error("Model output omitted retryDelayMs source.");
  return candidate.endsWith("\n") ? candidate : `${candidate}\n`;
}

async function callLuna(prompt) {
  if (physicalModelCalls >= MAX_PHYSICAL_CALLS) throw new Error("Physical model-call ceiling reached.");
  physicalModelCalls += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_WALL_MS);
  const started = performance.now();
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning: { effort: "medium" },
        input: prompt,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      }),
      signal: controller.signal,
    });
    const elapsedMilliseconds = performance.now() - started;
    const payload = await response.json();
    if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}.`);
    if (payload.status !== "completed") throw new Error(`OpenAI response status was ${String(payload.status)}.`);
    const inputTokens = Number(payload.usage?.input_tokens ?? 0);
    const outputTokens = Number(payload.usage?.output_tokens ?? 0);
    if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
      throw new Error("OpenAI returned invalid usage accounting.");
    }
    physicalInputTokens += inputTokens;
    physicalOutputTokens += outputTokens;
    return {
      source: extractSource(responseText(payload)),
      elapsedMilliseconds,
      inputTokens,
      outputTokens,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function commonPrompt(source, verification, cycle) {
  return [
    "You are repairing one small JavaScript function.",
    objective,
    "Public acceptance criteria:",
    ...acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    `Cycle: ${cycle}/3`,
    `Aggregate verification: ${verification.passedCount}/${verification.total}.`,
    `Unresolved public failure classes: ${verification.failureClasses.join(", ") || "none"}.`,
    "Use only the public criteria and aggregate failure classes above; hidden tests are not provided.",
    "Return only JSON with one string field named source containing the complete replacement function source.",
    "Current source:",
    source,
  ].join("\n");
}

function tacticSignals(before, after) {
  const result = [];
  for (const signal of ["Number", "Number.isFinite", "Date.parse", "Math.min", "Math.max", ".trim("]) {
    if (!before.includes(signal) && after.includes(signal)) result.push(`added:${signal}`);
  }
  return result;
}

async function runControl(shared) {
  let source = shared.source;
  let verification = evaluate(source);
  let activeModelMilliseconds = shared.elapsedMilliseconds;
  let inputTokens = shared.inputTokens;
  let outputTokens = shared.outputTokens;
  let logicalModelCalls = 1;
  for (let cycle = 2; cycle <= 3 && !verification.passed; cycle += 1) {
    const response = await callLuna(`${commonPrompt(source, verification, cycle)}\nControl policy: continue from the latest generated state.`);
    source = response.source;
    verification = evaluate(source);
    activeModelMilliseconds += response.elapsedMilliseconds;
    inputTokens += response.inputTokens;
    outputTokens += response.outputTokens;
    logicalModelCalls += 1;
  }
  return { source, verification, activeModelMilliseconds, inputTokens, outputTokens, logicalModelCalls };
}

async function runCanary(shared, baselineVerification) {
  const sharedVerification = evaluate(shared.source);
  let champion = sharedVerification.score > baselineVerification.score ? shared.source : baselineSource;
  let verification = sharedVerification.score > baselineVerification.score ? sharedVerification : baselineVerification;
  let activeModelMilliseconds = shared.elapsedMilliseconds;
  let inputTokens = shared.inputTokens;
  let outputTokens = shared.outputTokens;
  let logicalModelCalls = 1;
  const lessons = [{
    cycle: 1,
    scoreDelta: sharedVerification.score - baselineVerification.score,
    failureClasses: sharedVerification.failureClasses,
    tactics: tacticSignals(baselineSource, shared.source),
    outcome: sharedVerification.passed ? "verified_complete" : sharedVerification.score > baselineVerification.score ? "retained_gain" : "rolled_back",
  }];

  for (let cycle = 2; cycle <= 3 && !verification.passed; cycle += 1) {
    const prompt = `${commonPrompt(champion, verification, cycle)}\nReparodynamic policy:\n${JSON.stringify({
      preserveVerifiedChampion: true,
      recentLessons: lessons.slice(-2),
      instruction: "Preserve verified gains. Avoid repeating a no-gain tactic family. Prefer the smallest materially different repair addressing unresolved failure classes.",
    })}`;
    const response = await callLuna(prompt);
    const candidateVerification = evaluate(response.source);
    const scoreDelta = candidateVerification.score - verification.score;
    const accepted = candidateVerification.passed || scoreDelta > 0;
    lessons.push({
      cycle,
      scoreDelta,
      failureClasses: candidateVerification.failureClasses,
      tactics: tacticSignals(champion, response.source),
      outcome: candidateVerification.passed ? "verified_complete" : accepted ? "retained_gain" : "rolled_back",
    });
    if (accepted) {
      champion = response.source;
      verification = candidateVerification;
    }
    activeModelMilliseconds += response.elapsedMilliseconds;
    inputTokens += response.inputTokens;
    outputTokens += response.outputTokens;
    logicalModelCalls += 1;
  }
  return { source: champion, verification, activeModelMilliseconds, inputTokens, outputTokens, logicalModelCalls, lessons };
}

const baselineVerification = evaluate(baselineSource);
const shared = await callLuna(`${commonPrompt(baselineSource, baselineVerification, 1)}\nMatched first proposal: make the smallest high-confidence correction.`);
const control = await runControl(shared);
const canary = await runCanary(shared, baselineVerification);
const timeComparable = control.verification.passed && canary.verification.passed;
const speedRatio = timeComparable ? control.activeModelMilliseconds / canary.activeModelMilliseconds : null;
const speedIncreasePercent = speedRatio === null ? null : (speedRatio - 1) * 100;
const accuracyPreserved = canary.verification.score >= control.verification.score;

console.log(JSON.stringify({
  schemaVersion: 1,
  evidenceLevel: "LIVE_SINGLE_MATCHED_CODING_SPEED_TRACE",
  model: MODEL,
  sourceCommit: process.env.SARA_BENCHMARK_COMMIT_SHA ?? null,
  objectiveDigest: sha256(JSON.stringify({ objective, acceptanceCriteria })),
  sharedFirstProposalDigest: sha256(shared.source),
  baseline: baselineVerification,
  control: {
    verifiedComplete: control.verification.passed,
    score: control.verification.score,
    activeModelMilliseconds: Math.round(control.activeModelMilliseconds),
    logicalModelCalls: control.logicalModelCalls,
    inputTokens: control.inputTokens,
    outputTokens: control.outputTokens,
    finalSourceDigest: sha256(control.source),
  },
  canary: {
    verifiedComplete: canary.verification.passed,
    score: canary.verification.score,
    activeModelMilliseconds: Math.round(canary.activeModelMilliseconds),
    logicalModelCalls: canary.logicalModelCalls,
    inputTokens: canary.inputTokens,
    outputTokens: canary.outputTokens,
    finalSourceDigest: sha256(canary.source),
    lessons: canary.lessons,
  },
  physicalModelCalls,
  physicalInputTokens,
  physicalOutputTokens,
  timeComparable,
  speedRatio,
  speedIncreasePercent,
  accuracyPreserved,
  target200PercentMet: speedIncreasePercent !== null && speedIncreasePercent >= 200 && accuracyPreserved,
  generalClaimSupported: false,
}, null, 2));
