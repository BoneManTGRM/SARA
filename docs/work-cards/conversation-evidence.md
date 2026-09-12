# Conversation execution evidence and continuation

This document records demonstrated scope. It is not a declaration that the full digital-worker mission is complete.

## Reconciled baseline

- Repository: BoneManTGRM/SARA; branch main.
- Starting commit: `8be05646ef15d622f2a6c54e13a348309545f0d6`.
- Starting tree: `da961e648022f535a6af1025f5c4c25f1358257d`.
- Latest observed merged PR: [179](https://github.com/BoneManTGRM/SARA/pull/179); no subsequent main changes at reconciliation.
- Railway deployment: `9511beb7-fd0b-4c72-8dfc-663353c39d6e`, serving the same revision.
- PRODUCTION startup attestation: verified Constitution and audit, persistent volume mount `/data`, state directory `/data/sara` classified `persistent_volume`. Volume `c7cf193e-7abf-4e09-9084-1fa01fdc2bed`.
- Constitution digest: `8a04d0b85b385f8e2564624a7b2022dea58e8bae9a089a86727fc3f64bfea91e`.
- Existing mandate `internal-learning-2026-09-11` remained unrevoked, expires 2026-10-11. The learning campaign, 44 reservations, 87 memories and SHADOW candidate were retained. The observed learning retry-budget blocker was not bypassed.
- Existing startup proofs verified deterministic capability computations and denial boundaries, with zero new financial/communication authority. Those proofs do not establish ordinary conversation execution.

## Contracts and implementation

See [work card](conversation-worker.md) and [complete reachability matrix](conversation-reachability.md).

The owner dashboard's existing directive card now includes **Message SARA**, optional **Supplied material**, **Run supported work**, and **Refresh work**. Authentication uses the existing **Owner access** dialog. The existing authenticated Telegram Luna bridge selects the same two bounded families before its separate analysis-only fallback.

Qualified local request examples:

- “Review unfinished work, identify blockers, prioritize obligations, complete the authorized steps, and give me a brief.”
- “Inspect outstanding tasks and summarize what is stuck.”
- “Review these communications, identify commitments and prepare a brief.” Supply the communication separately as untrusted material.

Execution chain:

`authenticated HTTP message → immutable owner_work_received → current registry and strict input schemas → existing goal-to-work-queue compiler → capability_plan_registered → existing bounded plan runner → current invocation authority/evidence gate → digital_capability_executed receipts → result identity/coverage verification → owner_work_result → authenticated dashboard result`

Work review reads both existing self-development and revenue queues. It prioritizes explicit owner work and funded obligations before learning and unpaid opportunities. It calls the existing accountant when revenue jobs exist. It does not dispatch unresolved external fulfillment or label analysis as job completion. Changed queue or ledger state invalidates currentness without deleting historical receipts.

The secretary recipe extracts commitments and follow-up candidates, parses scheduling intent, drafts a response and makes a brief. It does not send messages or create calendar events. Original sender identity and sent time remain unverified when only a text body is supplied.

The existing worker resumes interrupted admitted plans. One failed-learning event may trigger diagnosis under the actual mandate, its existing action counter, current scope/expiry, stop control and exclusive store lock. Stable event identities prevent repeated capability execution. No new mandate or scheduler was created.

## Regression and boundary evidence

Provenance: LOCAL / UNIT_TEST using disposable real kernels and HTTP servers, not production owner credentials.

- Initial RED: the authenticated owner-message HTTP route returned 404 for all three initial cases.
- Stale-source RED: an earlier completed review incorrectly remained COMPLETE after durable work changed; corrected by exact source binding and historical-result projection.
- Mandate-accounting RED: a failed-job diagnosis did not consume an existing autonomy decision; corrected by the existing serialized routine-authority gate.
- Telegram RED: a supported 160-character bridge request ID returned 400; corrected with a stable bounded digest mapping.
- Qualification RED: a contract with failed qualification after planning reached a second invocation; corrected with fresh qualification checks at both plan selection and dispatch.
- Revenue-review RED: an existing revenue job was absent from review; corrected by reading that queue and the authoritative accountant.
- Mixed-domain RED: a NICO or database request containing “unfinished work” matched the work-review recipe; corrected by rejecting unsupported mixed-domain instructions before bounded selection.

`node --import tsx --test tests/conversation-worker.test.ts tests/dashboard-capability-inventory.test.ts tests/capability-plan.test.ts`: 18 passing, 0 failing on the local candidate before commit. These include duplicate and concurrent requests, crash after durable execution before acknowledgment, copied-state replay, immutable audit-prefix preservation, cancellation, stop between steps, quarantine, failed qualification, revoked mandate, injection, current source binding, exact accounting and protected routes.

`npm run verify` on the final local candidate exited 0: **1,368 passing tests, 0 failures; 14 passing HTTP checks; strict typecheck, demo and all required deterministic integration proofs passed**. No paid provider calls were made by the new path. Exact-head CI/security and production UI remain separate gates.

## Required higher-grade proof

The CI workflow requires `node --import tsx scripts/qualify-owner-conversation-ui.ts`: actual served dashboard, disposable authenticated kernel, sandboxed Chrome, desktop and mobile, real form submission and real receipts. This is ISOLATED evidence, not PRODUCTION.

Actual owner-facing production acceptance requires the deployed revision, an existing authenticated owner session, an ordinary harmless multi-step request, visible receipts and completion, exact recorded cost, and state/authority preservation. Internal startup probes cannot substitute. No production credential or authentication bypass is created.

## Remaining qualification scope

- The engineering and business contract suites retain their existing lower-level evidence. A complete ordinary-language software repair or customer-delivery chain is not established by this candidate.
- No ordinary adapter retrieves arbitrary repositories, websites, mailboxes, customer proof or agent results. Unsupported domains report the missing adapter or exact existing owner operation. No arbitrary URL is fetched.
- External execution, uncertain provider completion, paid routing and independent customer/production acceptance remain with their existing exact-authority executors and evidence controls. This read/draft path cannot grant that authority.
- The complete matrix classifies all 93 current contracts; ordinary support is explicitly limited to the connected recipes.

Consequential authority delta: **none**. No budgets, mandates, protected controls, revenue attestations, NICO approval, customer commitments or outbound communications were added.
