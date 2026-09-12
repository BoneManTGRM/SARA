import { canonicalJson, sha256 } from "../../canonical.ts";
import { CapabilityInputError, arraySchema, enumSchema, idSchema, objectSchema, textSchema, type Json, type Schema } from "../schema.ts";
import type { ExecutionContext, ExecutionOutput, EvidenceRecord, Provenance } from "../types.ts";
import { assessEvidence } from "../evidence.ts";

export type Data = Record<string, Json>;
export const data = (value: Json): Data => value as Data;
export const rows = (value: Json): Data[] => value as Data[];
export const strings = (value: Json): string[] => value as string[];
export const digest = (value: unknown): string => sha256(canonicalJson(value));
export const unique = (values: readonly string[]): string[] => [...new Set(values)].sort();
export const nullable = (schema: Schema): Schema => ({ ...schema, nullable: true });
export const bool: Schema = { type: "boolean" };
export const shaSchema: Schema = { ...textSchema(40, 40), pattern: "^[a-f0-9]{40}$" };
export const fileSchema = textSchema(512);
export const idsSchema = arraySchema(idSchema, 512);
export const stringListSchema = arraySchema(textSchema(1024), 512);
export const statusSchema = enumSchema("READY", "BLOCKED", "INCOMPLETE_EVIDENCE");
export const provenanceSchema = enumSchema("SUPPLIED", "LOCAL", "UNIT_TEST", "CI", "ISOLATED", "STAGING", "PRODUCTION", "EXTERNAL_READ_ONLY", "OWNER_OBSERVED");
export const identitySchema = arraySchema(objectSchema({ key: idSchema, value: nullable(textSchema(512, 0)) }), 64);
export const graphSchema = objectSchema({
  nodes: arraySchema(objectSchema({ id: idSchema, path: fileSchema, kind: enumSchema("RUNTIME", "API", "TEST", "DOCUMENTATION", "BUILD", "CONFIGURATION", "STATE", "AUTHENTICATION", "AUTHORIZATION", "INTEGRATION", "EXTERNAL_REPOSITORY") }), 512),
  edges: arraySchema(objectSchema({ from: idSchema, to: idSchema, relation: enumSchema("DEPENDS_ON", "CALLS", "COVERS", "READS", "WRITES") }), 1024),
});
export function requireUnique(values: Data[], field: string): void {
  const seen = new Set<Json>();
  for (const value of values) {
    if (seen.has(value[field]!)) throw new CapabilityInputError("DUPLICATE_ID", `$.${field}`);
    seen.add(value[field]!);
  }
}
export function suppliedAnalysis(output: Data, unknowns: string[] = [], inferred: Json[] = []): ExecutionOutput {
  return { output, observed: [{ basis: "SUPPLIED_INPUT_ANALYSIS", externalStateObserved: false }], inferred,
    unknowns: unique(["Supplied data is not independently verified external state.", ...unknowns]),
    confidence: { level: "UNASSESSED", basis: "Deterministic supplied-data analysis. No probability of real-world correctness has been calibrated." } };
}
export function identityFromInput(value: Json): Record<string, string | null> {
  const entries = rows(value); requireUnique(entries, "key");
  return Object.fromEntries(entries.map(entry => [String(entry.key), entry.value as string | null]));
}
export function evidenceById(context: ExecutionContext, id: string): EvidenceRecord | undefined {
  return context.evidence.find(record => record.id === id || record.receiptId === id || record.contentDigest === id);
}
export function verifyEvidence(context: ExecutionContext, ids: string[], required: { provenance: Provenance; claim: string; identity: Record<string, string | null> }) {
  const inspected = ids.map(id => {
    const record = evidenceById(context, id);
    if (!record) return { id, status: "MISSING", reasons: ["EVIDENCE_NOT_IN_TRUSTED_CONTEXT"] };
    // Both identities must be present. A receipt with an unrelated subject cannot prove a release.
    const bindingMissing = Object.keys(required.identity).some(key => record.subject[key] === undefined);
    const result = assessEvidence({ record, requiredProvenance: [required.provenance], requiredClaims: [required.claim],
      currentIdentity: { ...context.currentIdentity, ...required.identity } });
    return { id, status: bindingMissing ? "INCOMPLETE_EVIDENCE" : result.status,
      reasons: bindingMissing ? [...result.reasons, "REQUIRED_SUBJECT_BINDING_MISSING"] : result.reasons };
  });
  return { passed: inspected.some(item => item.status === "VALID"), inspected };
}
/** Never emit supplied log text. Evidence uses immutable source positions and digests. */
export function logReference(stepId: string, index: number, line: string): Data {
  return { stepId, lineIndex: index + 1, contentDigest: digest(line) };
}
