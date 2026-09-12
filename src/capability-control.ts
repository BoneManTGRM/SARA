import { canonicalJson, sha256 } from "./canonical.ts";
import { EventStoreIntegrityError, type StoredEvent } from "./store.ts";
import type { Mutation } from "./types.ts";

/** Operational eligibility is deliberately separate from immutable promotion history. */
export type LearnedCapabilityState = "ACTIVE" | "QUARANTINED" | "DISABLED";
export type LearnedCapabilityControl = {
  mutationId: string;
  candidateDigest: string;
  state: LearnedCapabilityState;
  sequence: number;
  reason: string | null;
  evidenceEventIds: string[];
};
export type LearnedCapabilityControlInput = {
  requestId: string;
  state: LearnedCapabilityState;
  reason: string;
  evidenceEventIds: string[];
};
export type LearnedCapabilityControlRequest = LearnedCapabilityControlInput & {
  mutationId: string;
  candidateDigest: string;
  priorState: LearnedCapabilityState;
  expectedControlSequence: number;
  qualificationEventId: string | null;
  targetId: string;
};
const STATES = new Set<LearnedCapabilityState>(["ACTIVE", "QUARANTINED", "DISABLED"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const SECRET_ASSIGNMENT = /(?:password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization)\s*[:=]\s*\S+/iu;

export function validateLearnedCapabilityControlInput(input: LearnedCapabilityControlInput): LearnedCapabilityControlInput {
  if (!input || typeof input !== "object" || Object.keys(input).sort().join() !== "evidenceEventIds,reason,requestId,state" ||
      typeof input.requestId !== "string" || !ID.test(input.requestId) || !STATES.has(input.state) ||
      typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000 || SECRET_ASSIGNMENT.test(input.reason) ||
      !Array.isArray(input.evidenceEventIds) || input.evidenceEventIds.length < 1 || input.evidenceEventIds.length > 32 ||
      input.evidenceEventIds.some(id => typeof id !== "string" || !ID.test(id))) {
    throw new Error("INVALID_LEARNED_CAPABILITY_CONTROL_REQUEST");
  }
  return {requestId:input.requestId,state:input.state,reason:input.reason.trim(),evidenceEventIds:[...new Set(input.evidenceEventIds)].sort()};
}

export function learnedControlTarget(request: Omit<LearnedCapabilityControlRequest, "targetId">): string {
  return `learned-capability-control:${sha256(canonicalJson(request))}`;
}

/** Reads only kernel-owned, integrity-checked history. There is deliberately no append API here. */
export function learnedCapabilityControl(events: readonly StoredEvent[], mutation: Pick<Mutation, "id" | "candidateDigest">): LearnedCapabilityControl {
  let current: LearnedCapabilityControl = {mutationId:mutation.id,candidateDigest:mutation.candidateDigest,
    state:"ACTIVE",sequence:0,reason:null,evidenceEventIds:[]};
  let previouslyQualified = false;
  for (const event of events) {
    if (!event.data || typeof event.data !== "object") continue;
    const data = event.data as Record<string, unknown>;
    if (data.mutationId !== mutation.id) continue;
    if (event.type === "learning_qualification_passed" && data.candidateDigest === mutation.candidateDigest) previouslyQualified = true;
    const legacyExecutionFailure = event.type === "learning_skill_reuse_failed" && data.controlEffect !== "NONE" &&
      (data.expectedControlSequence === undefined || data.expectedControlSequence === current.sequence);
    const regression = event.type === "learning_qualification_failed" && previouslyQualified;
    const restorationFailure = event.type === "learned_capability_requalification_failed";
    if ((legacyExecutionFailure || regression || restorationFailure) && data.candidateDigest === mutation.candidateDigest) {
      current = {...current,state:current.state === "DISABLED" ? "DISABLED" : "QUARANTINED",sequence:event.sequence,
        reason:legacyExecutionFailure ? "Kernel execution restriction requires owner-reviewed qualification." : "Independent qualification failed.",evidenceEventIds:[event.id]};
    }
    if (event.type !== "learned_capability_control_changed") continue;
    const request = event.data as LearnedCapabilityControlRequest;
    const {targetId,...unsigned} = request;
    if (event.actor.kind !== "owner" || event.actor.authenticated !== true ||
        request.candidateDigest !== mutation.candidateDigest || !DIGEST.test(request.candidateDigest) ||
        request.priorState !== current.state || request.expectedControlSequence !== current.sequence ||
        !STATES.has(request.state) || learnedControlTarget(unsigned) !== targetId) {
      throw new EventStoreIntegrityError("Learned-capability control history has an invalid identity or transition.");
    }
    if (request.state === "ACTIVE") {
      const proof = events.find(candidate => candidate.id === request.qualificationEventId);
      const qualification = proof?.data as {mutationId?:string;candidateDigest?:string} | undefined;
      if (!proof || proof.type !== "learning_qualification_passed" || proof.sequence <= current.sequence || proof.sequence >= event.sequence ||
          qualification?.mutationId !== mutation.id || qualification.candidateDigest !== mutation.candidateDigest) {
        throw new EventStoreIntegrityError("Restored capability lacks fresh preceding independent qualification.");
      }
    }
    current = {mutationId:mutation.id,candidateDigest:mutation.candidateDigest,state:request.state,
      sequence:event.sequence,reason:request.reason,evidenceEventIds:[...request.evidenceEventIds]};
  }
  return current;
}

export function assertLearnedCapabilityActive(control: LearnedCapabilityControl): void {
  if (control.state !== "ACTIVE") throw new Error(`LEARNED_SKILL_MAINTENANCE_REQUIRED:${control.state}`);
}

export function compileLearnedCapabilityControl(input: {
  mutation: Mutation;
  events: readonly StoredEvent[];
  request: LearnedCapabilityControlInput;
  environmentDigest: string;
  contractDigest: string | null;
}): LearnedCapabilityControlRequest {
  const request = validateLearnedCapabilityControlInput(input.request);
  const control = learnedCapabilityControl(input.events,input.mutation);
  if (request.state === control.state) throw new Error("LEARNED_CAPABILITY_CONTROL_ALREADY_IN_STATE");
  if (request.evidenceEventIds.some(id => !input.events.some(event => event.id === id))) throw new Error("CONTROL_EVIDENCE_NOT_FOUND");
  let qualificationEventId: string | null = null;
  if (request.state === "ACTIVE") {
    const proof = input.events.filter(event => {
      if (event.type !== "learning_qualification_passed" || event.sequence <= control.sequence) return false;
      const data = event.data as {mutationId:string;candidateDigest:string;contractDigest:string;receipt?:{environmentDigest:string}};
      return data.mutationId === input.mutation.id && data.candidateDigest === input.mutation.candidateDigest &&
        data.contractDigest === input.contractDigest && data.receipt?.environmentDigest === input.environmentDigest;
    }).at(-1);
    if (!proof) throw new Error("FRESH_INDEPENDENT_QUALIFICATION_REQUIRED");
    qualificationEventId = proof.id;
  }
  const unsigned = {...request,mutationId:input.mutation.id,candidateDigest:input.mutation.candidateDigest,
    priorState:control.state,expectedControlSequence:control.sequence,qualificationEventId};
  return {...unsigned,targetId:learnedControlTarget(unsigned)};
}
