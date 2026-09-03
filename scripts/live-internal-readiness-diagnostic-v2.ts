import { OpenAIResponsesClient } from "../src/openai-worker.ts";

const originalExecute = OpenAIResponsesClient.prototype.execute;
let completedExecutions = 0;

function boundedPublicVerifierSummary(outputText: string): Record<string, unknown> {
  const normalized = outputText.replace(/\s+/gu, " ").trim();
  const firstLine = outputText.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  return {
    verdict: firstLine === "VERDICT: PASS"
      ? "PASS"
      : firstLine === "VERDICT: FAIL"
        ? "FAIL"
        : "MALFORMED",
    characterCount: outputText.length,
    mentionsUnsupportedClaim: /unsupported|overclaim|not supported|cannot substantiate/iu.test(outputText),
    mentionsEvidenceGap: /evidence gap|missing evidence|not provided|unavailable|not observable/iu.test(outputText),
    mentionsCitationProblem: /citation|permalink|line anchor|source location|source-linked/iu.test(outputText),
    mentionsScopeProblem: /out of scope|scope|bounded|sampled/iu.test(outputText),
    publicReasonPreview: normalized.slice(0, 900),
  };
}

OpenAIResponsesClient.prototype.execute = async function (
  this: OpenAIResponsesClient,
  input: Parameters<OpenAIResponsesClient["execute"]>[0],
): ReturnType<OpenAIResponsesClient["execute"]> {
  const result = await originalExecute.call(this, input);
  completedExecutions += 1;
  if (completedExecutions === 3) {
    console.log(`SARA_INTERNAL_FREE_PROOF_VERIFIER_DIAGNOSTIC=${JSON.stringify(
      boundedPublicVerifierSummary(result.outputText),
    )}`);
  }
  return result;
};

await import("./live-internal-readiness-diagnostic.ts");
