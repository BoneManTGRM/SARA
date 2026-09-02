import type { CandidateGenerator, SkillCandidateProposal } from "./types.ts";

export const CLOUDFLARE_FREE_MODEL = "@cf/zai-org/glm-4.7-flash" as const;
export const CLOUDFLARE_FREE_GENERATOR_ID = "cloudflare-free-pure-skill-v1" as const;

const ACCOUNT_ID = /^[a-f0-9]{32}$/iu;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_PROPOSAL_BYTES = 64 * 1024;
const MAX_OBJECTIVE_LENGTH = 1_000;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type CloudflareGeneratorOptions = {
  accountId: string;
  apiToken: string;
  workersPlan: string;
  repairProposal?: SkillCandidateProposal;
  repairFeedback?: string;
  fetcher?: Fetcher;
};

function requireCredentials(options: CloudflareGeneratorOptions): void {
  if (options.workersPlan !== "free") {
    throw new Error("The Cloudflare candidate generator is locked to the Workers Free plan.");
  }
  if (!ACCOUNT_ID.test(options.accountId)) {
    throw new Error("Cloudflare Account ID must be 32 hexadecimal characters.");
  }
  if (
    options.apiToken.length < 20 ||
    options.apiToken.length > 512 ||
    /\s/u.test(options.apiToken)
  ) {
    throw new Error("Cloudflare API token is malformed.");
  }
}

function proposalPrompt(
  input: Parameters<CandidateGenerator["generate"]>[0],
  repairProposal?: SkillCandidateProposal,
  repairFeedback?: string,
): string {
  if (!input.objective.trim() || input.objective.length > MAX_OBJECTIVE_LENGTH) {
    throw new Error("Owner objective must contain 1–1,000 characters.");
  }
  const prompt = [
    "Create exactly one bounded SARA Genome Lab skill candidate for this owner objective:",
    input.objective,
    "",
    "Acceptance criteria:",
    ...input.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Return one JSON object with exactly these fields:",
    '{"schemaVersion":1,"skillName":"...","summary":"...","source":"...","tests":[{"name":"...","input":null,"expected":null}],"limitations":["..."]}',
    "",
    "The source must be deterministic pure TypeScript and export only runSkill(input: unknown): unknown.",
    "Use no imports, network, filesystem, secrets, timers, dynamic code, outreach, applications, contracts, spending, deployment, account creation, payment activity, Date, randomness, or ambient authority.",
    "Include 2–8 behavioral tests. Keep all output below 64 KiB. Do not use Markdown fences or commentary.",
    "Before responding, dry-run runSkill for every test. Each expected value must exactly equal the complete observed return value after recursive object-key normalization.",
    `Constitution digest: ${input.constitutionDigest}`,
    `Bounded memory context digest: ${input.memoryContext.contextDigest}`,
  ];
  if (repairProposal) {
    prompt.push(
      "",
      "The previous proposal passed source and TypeScript restrictions but failed isolated behavioral verification.",
      "Repair the source and/or exact expected values, return the complete replacement proposal, and do not omit any required field.",
      `Bounded independent verifier feedback: ${repairFeedback || "Behavioral outputs did not exactly match the proposed expected values."}`,
      `Previous rejected proposal: ${JSON.stringify(repairProposal)}`,
    );
  }
  return prompt.join("\n");
}

function stripSingleFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```$/iu.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

function balancedJsonObjects(value: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

function parseOneJsonObject(content: string): unknown {
  const stripped = stripSingleFence(content);
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    const parsed = balancedJsonObjects(stripped).flatMap((candidate) => {
      try {
        return [JSON.parse(candidate) as unknown];
      } catch {
        return [];
      }
    });
    if (parsed.length !== 1) {
      throw new Error("Cloudflare candidate proposal was not valid JSON or was ambiguous.");
    }
    return parsed[0];
  }
}

function parseProposal(content: string): SkillCandidateProposal {
  if (!content || Buffer.byteLength(content, "utf8") > MAX_PROPOSAL_BYTES) {
    throw new Error("Cloudflare candidate proposal is empty or exceeds 64 KiB.");
  }
  const value = parseOneJsonObject(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cloudflare candidate proposal must be one JSON object.");
  }
  const proposal = value as Partial<SkillCandidateProposal>;
  const allowedKeys = ["limitations", "schemaVersion", "skillName", "source", "summary", "tests"];
  if (Object.keys(proposal).sort().join("\n") !== allowedKeys.join("\n")) {
    throw new Error("Cloudflare candidate proposal contains unsupported fields.");
  }
  if (
    proposal.schemaVersion !== 1 ||
    typeof proposal.skillName !== "string" ||
    typeof proposal.summary !== "string" ||
    typeof proposal.source !== "string" ||
    !Array.isArray(proposal.tests) ||
    !Array.isArray(proposal.limitations)
  ) {
    throw new Error("Cloudflare candidate proposal is structurally incomplete.");
  }
  return proposal as SkillCandidateProposal;
}

function extractContent(value: unknown): string {
  const response = value as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Cloudflare returned no candidate content.");
  }
  return content;
}

export function createCloudflareFreeCandidateGenerator(
  options: CloudflareGeneratorOptions,
): CandidateGenerator {
  requireCredentials(options);
  const fetcher = options.fetcher ?? fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/v1/chat/completions`;
  return {
    id: CLOUDFLARE_FREE_GENERATOR_ID,
    external: true,
    maximumCostUsd: 0,
    async generate(input) {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: CLOUDFLARE_FREE_MODEL,
          messages: [
            {
              role: "system",
              content: "You generate untrusted pure TypeScript candidates for independent verification. Return JSON only.",
            },
            { role: "user", content: proposalPrompt(input, options.repairProposal, options.repairFeedback) },
          ],
          response_format: { type: "json_object" },
          stream: false,
          temperature: 0,
          max_completion_tokens: 8_192,
          seed: 1,
        }),
      });
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw new Error("Cloudflare response exceeded the bounded envelope.");
      }
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
        throw new Error("Cloudflare response exceeded the bounded envelope.");
      }
      if (!response.ok) {
        throw new Error(`Cloudflare inference failed with HTTP ${response.status}.`);
      }
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        throw new Error("Cloudflare returned malformed JSON.");
      }
      return parseProposal(extractContent(value));
    },
  };
}
