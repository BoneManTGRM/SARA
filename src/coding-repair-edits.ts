import { sha256 } from "./canonical.ts";
import { INITIAL_CODING_REPAIR_LIMITS } from "./coding-repair-policy.ts";
import type { CodingRepairLimits, CodingRepairProposal } from "./coding-repair-types.ts";
import type { ProgramCandidateProposal } from "./types.ts";

export const CODING_REPAIR_EDITS_OUTPUT_CONTRACT = "OUTPUT CONTRACT: SARA_CODING_REPAIR_EDITS_V1";
const MAX_FILE_BYTES = 16 * 1024;
const MAX_EDITS = 8;
const DIGEST = /^[a-f0-9]{64}$/u;

export const CODING_REPAIR_EDITS_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "baseArtifactDigest", "failureFingerprint", "strategy", "changes", "limitations"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    baseArtifactDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    failureFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
    strategy: { type: "string", enum: ["surgical", "deep"] },
    changes: {
      type: "array", minItems: 1, maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        required: ["path", "expectedContentDigest", "edits"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 240 },
          expectedContentDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
          edits: {
            type: "array", minItems: 1, maxItems: MAX_EDITS,
            items: {
              type: "object", additionalProperties: false, required: ["find", "replace"],
              properties: {
                find: { type: "string", minLength: 1, maxLength: MAX_FILE_BYTES },
                replace: { type: "string", maxLength: MAX_FILE_BYTES },
              },
            },
          },
        },
      },
    },
    limitations: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 300 } },
  },
} as const;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid compact repair object.");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) {
    throw new Error("Compact repair fields are not the exact contract.");
  }
  return result;
}

function text(value: unknown, maximumBytes: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.length) || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error("Compact repair text exceeds its bounds.");
  }
  return value;
}

/** Literal, simultaneous edits against a digest-bound original. No fuzzy matching or execution. */
export function expandCodingRepairEdits(input: {
  value: unknown;
  candidate: ProgramCandidateProposal;
  artifactDigest: string;
  failureFingerprints: ReadonlySet<string>;
  strategy: "surgical" | "deep";
  limits: CodingRepairLimits;
}): CodingRepairProposal {
  for (const key of ["maximumCycles", "surgicalFiles", "surgicalChangedLines", "deepFiles", "deepChangedLines", "maximumModelSpendUsd"] as const) {
    if (!Number.isFinite(input.limits[key]) || input.limits[key] <= 0 ||
        input.limits[key] > INITIAL_CODING_REPAIR_LIMITS[key] ||
        (key !== "maximumModelSpendUsd" && !Number.isInteger(input.limits[key]))) {
      throw new Error("Compact repair cannot expand or malform an authority ceiling.");
    }
  }
  if (INITIAL_CODING_REPAIR_LIMITS.protectedPaths.some(path => !input.limits.protectedPaths.includes(path))) {
    throw new Error("Compact repair cannot remove a protected path.");
  }
  const value = record(input.value, ["schemaVersion", "baseArtifactDigest", "failureFingerprint", "strategy", "changes", "limitations"]);
  if (value.schemaVersion !== 1 || value.baseArtifactDigest !== input.artifactDigest || !DIGEST.test(input.artifactDigest)) {
    throw new Error("Compact repair targets an invalid or stale artifact.");
  }
  if (typeof value.failureFingerprint !== "string" || !input.failureFingerprints.has(value.failureFingerprint)) {
    throw new Error("Compact repair targets an unknown failure.");
  }
  if (value.strategy !== "surgical" && value.strategy !== "deep") throw new Error("Compact repair strategy is malformed.");
  const maximumFiles = input.strategy === "surgical" ? input.limits.surgicalFiles : input.limits.deepFiles;
  if (!Array.isArray(value.changes) || !value.changes.length || value.changes.length > maximumFiles) {
    throw new Error("Compact repair exceeds the controller file ceiling.");
  }
  const files = new Map(input.candidate.files.map(file => [file.path, file.content]));
  const seen = new Set<string>();
  const changes = value.changes.map(raw => {
    const change = record(raw, ["path", "expectedContentDigest", "edits"]);
    const path = text(change.path, 240);
    if (input.limits.protectedPaths.some(prefix => path === prefix || path.startsWith(prefix))) {
      throw new Error("Compact repair targets a protected path.");
    }
    const original = files.get(path);
    if (original === undefined || seen.has(path)) throw new Error("Compact repair targets an unknown or duplicate file.");
    seen.add(path);
    if (sha256(original) !== change.expectedContentDigest) throw new Error("Compact repair has a stale file digest.");
    if (!Array.isArray(change.edits) || !change.edits.length || change.edits.length > MAX_EDITS) {
      throw new Error("Compact repair exceeds its edit ceiling.");
    }
    const ranges = change.edits.map(rawEdit => {
      const edit = record(rawEdit, ["find", "replace"]);
      const find = text(edit.find, MAX_FILE_BYTES);
      const replace = text(edit.replace, MAX_FILE_BYTES, true);
      const start = original.indexOf(find);
      if (start < 0 || original.indexOf(find, start + 1) !== -1) throw new Error("Compact repair anchor is absent or ambiguous.");
      if (find === replace) throw new Error("Compact repair contains a no-op edit.");
      return { start, end: start + find.length, replace };
    }).sort((a, b) => a.start - b.start);
    let cursor = 0;
    let replacementText = "";
    for (const range of ranges) {
      if (range.start < cursor) throw new Error("Compact repair edits overlap.");
      replacementText += original.slice(cursor, range.start) + range.replace;
      cursor = range.end;
    }
    replacementText += original.slice(cursor);
    if (!replacementText.trim() || replacementText === original || Buffer.byteLength(replacementText, "utf8") > MAX_FILE_BYTES) {
      throw new Error("Compact repair result is empty, unchanged, or oversized.");
    }
    return { path, expectedContentDigest: sha256(original), replacementText };
  });
  if (!Array.isArray(value.limitations) || value.limitations.length > 16 || value.limitations.some(item => typeof item !== "string" || !item.trim() || item.length > 300)) {
    throw new Error("Compact repair limitations are malformed.");
  }
  return {
    schemaVersion: 1, baseArtifactDigest: input.artifactDigest,
    failureFingerprint: value.failureFingerprint,
    strategy: input.strategy,
    changes, limitations: [...value.limitations] as string[],
  };
}
