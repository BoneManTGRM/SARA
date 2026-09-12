# Conversation to bounded work

Baseline: main `8be05646ef15d622f2a6c54e13a348309545f0d6`, tree `da961e648022f535a6af1025f5c4c25f1358257d`. Railway deployment `9511beb7-fd0b-4c72-8dfc-663353c39d6e` attests the same serving revision, verified audit and persistent `/data/sara` under `/data`. PR179 remains latest; no changes since supplied baseline.

Trace: authenticated Telegram action bridge -> OwnerAssistant.analyze -> bounded Luna analysis with no tools. Owner dashboard -> structured self-development job. Structured capability goals -> compileGoalExecution -> executeCapabilityPlan -> invokeCapability -> authority/evidence gate -> hash-chained receipt. There is no ordinary conversation connection between these paths.

Contract: ordinary owner messages select explicitly supported bounded workflows, gather existing durable work, construct schema-checked inputs, register immutable plans in the existing audit, execute through the existing plan runner, and display receipt-backed progress. Unsupported goals and missing facts must be explicit. Read/draft completion does not imply completion of underlying software, commercial or learning jobs. No model-generated principal, authority, evidence grade or completion predicate is accepted.

Invariants: no second registry/store/scheduler; no changed Constitution, mandates, ceilings, authentication, learning controls, customer/revenue truth or NICO controls. External effects cannot enter the conversational plan runner. Quarantined/current-contract, emergency-stop and evidence checks occur before each step. Requests bind exact text and supplied context; duplicate messages reuse one durable request and plan. Frozen inputs survive restart; changed subjects remain identifiable. Unknown external completion is never retried here.

Verification: RED actual authenticated HTTP message route; GREEN same route through real kernel and immutable receipts; restart/replay/concurrency/authentication/injection/stop tests. Required full verification, sandboxed browser and CodeQL on exact head. Actual authenticated production UI acceptance remains required and cannot be substituted by kernel runtime probes. No production credentials are fabricated.

This work card does not itself claim any acceptance workflow is complete.
