import assert from "node:assert/strict";
import { test } from "node:test";
import { learnedCapabilityControl } from "../src/capability-control.ts";
import type { StoredEvent } from "../src/store.ts";

const mutation={id:"mutation-fixture",candidateDigest:"a".repeat(64)};
const event=(type:string,data:unknown,sequence:number):StoredEvent=>({id:`event-${sequence}`,sequence,type,data,
  occurredAt:`2026-09-11T00:00:${String(sequence).padStart(2,"0")}Z`,actor:{id:"sara",kind:"sara",authenticated:true},previousHash:"0".repeat(64),hash:"1".repeat(64)});

test("legacy execution restrictions remain quarantined rather than silently re-enabling",()=>{
  const events=[event("learning_skill_reuse_failed",{mutationId:mutation.id,candidateDigest:mutation.candidateDigest},1)];
  assert.equal(learnedCapabilityControl(events,mutation).state,"QUARANTINED");
});

test("an obsolete regression receipt cannot quarantine a newer control epoch",()=>{
  const events=[event("learning_skill_reuse_failed",{mutationId:mutation.id,candidateDigest:mutation.candidateDigest,
    controlEffect:"QUARANTINED",expectedControlSequence:10},11)];
  assert.equal(learnedCapabilityControl(events,mutation).state,"ACTIVE","A stale regression must be retained without acquiring current disabling authority");
});
