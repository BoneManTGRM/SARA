# Conversation to bounded work

Baseline: main `8be05646ef15d622f2a6c54e13a348309545f0d6`, tree `da961e648022f535a6af1025f5c4c25f1358257d`. Railway deployment `9511beb7-fd0b-4c72-8dfc-663353c39d6e` attests the same serving revision, verified audit and persistent `/data/sara` under `/data`. PR179 remains latest; no changes since supplied baseline.

Trace: authenticated Telegram action bridge -> OwnerAssistant.analyze -> bounded Luna analysis with no tools. Owner dashboard -> structured self-development job. Structured capability goals -> compileGoalExecution -> executeCapabilityPlan -> invokeCapability -> authority/evidence gate -> hash-chained receipt. There is no ordinary conversation connection between these paths.

Contract: ordinary owner messages select explicitly supported bounded workflows, gather existing durable work, construct schema-checked inputs, register immutable plans in the existing audit, execute through the existing plan runner, and display receipt-backed progress. Unsupported goals and missing facts must be explicit. Read/draft completion does not imply completion of underlying software, commercial or learning jobs. No model-generated principal, authority, evidence grade or completion predicate is accepted.

Invariants: no second registry/store/scheduler; no changed Constitution, mandates, ceilings, authentication, learning controls, customer/revenue truth or NICO controls. External effects cannot enter the conversational plan runner. Quarantined/current-contract, emergency-stop and evidence checks occur before each step. Requests bind exact text and supplied context; duplicate messages reuse one durable request and plan. Frozen inputs survive restart; changed subjects remain identifiable. Unknown external completion is never retried here.

Verification: RED actual authenticated HTTP message route; GREEN same route through real kernel and immutable receipts; restart/replay/concurrency/authentication/injection/stop tests. Required full verification, sandboxed browser and CodeQL on exact head. Actual authenticated production UI acceptance remains required and cannot be substituted by kernel runtime probes. No production credentials are fabricated.

This work card does not itself claim any acceptance workflow is complete.

## Supplied report and quote intake contract

Follow-up baseline: merged main `d05cdf0458da6866f772fa9def8881822e20cd44`, tree `d7a6c9fa360e5588377ef525fdf55adcb36f8738`. PR180 is deployed. The actual owner page remains locked after a rejected token; production conversation acceptance is pending, not inferred from isolated evidence.

Behavior: ordinary requests to diagnose a supplied defect report or review a supplied quote reach existing deterministic capabilities. Plain report sentences or familiar labels provide facts; missing or conflicting values prompt precise questions. Inputs use the current supplied material or previously admitted material from the same workflow family. Cross-family retained content cannot be silently selected. No arbitrary URL, attachment code, model tool, or new registry is introduced.

Inputs/outputs: bounded owner instruction plus separately supplied untrusted report or opportunity; exact source references, observed/derived/unknown fields, selected contracts, immutable plan, computation receipts, concrete analysis and unresolved requirements. Money uses explicit USD amounts and integer micro-units. Unstated costs remain unknown, including zero costs. Invalid, duplicate or ambiguous economic facts cannot become a favorable margin.

Authority/budget: only existing READ_ONLY/DRAFT_ONLY contracts through the current invocation gate; no paid dispatch. Proposal approval receipts are not synthesized. Report analysis does not run reproduction commands, repair code, verify independent tests, release software, accept a job or transmit a proposal.

Failure/recovery: use the existing request identity, audit, plan replay, stop/cancellation and contract-currentness checks. Reused source identity is frozen. Material overflow and ambiguity fail visibly without silently truncating facts. All required source gaps remain BLOCKED even when eligible analysis receipts verify.

Acceptance: actual authenticated owner HTTP requests select the expected recipe and produce exact receipts and visible analysis; unknowns remain unknown, injection cannot create authority, unsupported mixed-domain requests remain restricted, repeated requests do not duplicate execution, retained material is selected only within its original family. RED precedes implementation; full local and exact-head CI/security plus isolated served-browser verification are required before merge. This bounded extension is not full software repair or customer-delivery qualification.
