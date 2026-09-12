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

The existing production live-activity panel displays conversation results and evidence. The owner dashboard's directive card now includes **Message SARA**, optional **Supplied material**, **Run supported work**, and **Refresh work**. Authentication uses the existing **Owner access** dialog. The existing authenticated Telegram Luna bridge selects the same two bounded families before its separate analysis-only fallback.

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

`node --import tsx --test tests/conversation-worker.test.ts tests/dashboard-capability-inventory.test.ts tests/capability-plan.test.ts`: 23 passing, 0 failing on the final input-gathering candidate before commit (also including `tests/owner-job-activity-runtime.test.ts`). These include duplicate and concurrent requests, crash after durable execution before acknowledgment, copied-state replay, immutable audit-prefix preservation, cancellation, stop between steps, quarantine, failed qualification, revoked mandate, injection, current source binding, exact accounting and protected routes.

`npm run verify` on the input-gathering integration exited 0: **1,371 passing tests, 0 failures; 14 passing HTTP checks; strict typecheck, demo and all required deterministic integration proofs passed**. No paid provider calls were made by the new path. Exact-head CI/security and production UI remain separate gates.

## Required higher-grade proof

The CI workflow requires `node --import tsx scripts/qualify-owner-conversation-ui.ts`: actual served dashboard, disposable authenticated kernel, sandboxed Chrome, the existing production theme/activity transform, desktop and mobile, real form submission and real receipts. This is ISOLATED evidence, not PRODUCTION.

Actual owner-facing production acceptance requires the deployed revision, an existing authenticated owner session, an ordinary harmless multi-step request, visible receipts and completion, exact recorded cost, and state/authority preservation. Internal startup probes cannot substitute. No production credential or authentication bypass is created.

## Remaining qualification scope

- The engineering and business contract suites retain their existing lower-level evidence. A complete ordinary-language software repair or customer-delivery chain is not established by this candidate.
- No ordinary adapter retrieves arbitrary repositories, websites, mailboxes, customer proof or agent results. Unsupported domains report the missing adapter or exact existing owner operation. No arbitrary URL is fetched.
- External execution, uncertain provider completion, paid routing and independent customer/production acceptance remain with their existing exact-authority executors and evidence controls. This read/draft path cannot grant that authority.
- The complete matrix classifies all 93 current contracts; ordinary support is explicitly limited to the connected recipes.

Consequential authority delta: **none**. No budgets, mandates, protected controls, revenue attestations, NICO approval, customer commitments or outbound communications were added.

Production-layout RED/GREEN: a focused transformation test first proved the result view was outside existing activity. The corrected runtime transform retains exactly one protected result view inside activity and an anchor from the message form. The real-browser gate now installs the same response transform as production. `npm run verify` then exited 0 with 1,369 tests and 14 HTTP checks.

Durable-context RED/GREEN: current job capability readiness now replaces historical missing-capability snapshots, with freshness bound only to relevant capability records. Previously supplied authorized communication material is retrieved; multiple sources require a focused choice or “latest supplied messages”. A repeated body still selects the latest source event. All 23 focused checks pass. The integrated local gate passed 1,371 tests and 14 HTTP checks before the final latest-source correction; the full gate is rerun on the published candidate, and exact-head CI remains required. The browser gate now exercises four ordinary requests and 28 real receipts, including retrieval of durable communication input.

## Supplied-work intake follow-up

The follow-up starts from PR180's deployed merge `d05cdf0458da6866f772fa9def8881822e20cd44`. The actual production browser's secure authentication submission was rejected with “Owner token was not accepted.” No authenticated production conversation receipt has been observed. That is a pending acceptance boundary, not a passing probe.

The additional bounded owner requests are:

- “Diagnose this software defect and give me a brief.” Supply a report with expected behavior, observed behavior, environment and reproduction steps. Familiar labels such as `Expected:` and `Observed:` are accepted. The result is a reproduction plan, separation of symptom from unknown root cause, and a brief identifying the execution/evidence still needed. No report or attachment code runs.
- “Review this business quote and draft a proposal.” Supply the problem, deliverables, acceptance criteria, explicit USD price, direct cash cost, model API cost, infrastructure cost, tooling cost, risk reserve and minimum margin. Facts may use `Price: USD 200.` or `Price is USD 200.` on separate lines. SARA calculates the expected cash contribution and margin and drafts only the attributed proposal content. It does not infer zeros, approve the opportunity, count revenue, accept work or send a proposal.

Three initial regression cases failed because both ordinary request families had no route. They subsequently passed through actual authenticated HTTP and real kernel receipts. Boundary checks cover contradictory cost values, non-USD amounts, negative amounts, out-of-range percentages, oversized reports, mixed domains and cross-family durable input. One boundary test initially reused its own previously admitted oversized report; the fixture was corrected to check absence before admitting that report. The material was correctly retained, not deleted to satisfy the test.

Previously supplied material is retrieved only within its admitted workflow family. Replays retain exact receipts. Source-derived analysis does not establish independent test, release, production or customer evidence. The activity view displays reproduction status, unknown root cause, cash contribution, margin, draft deliverables and approval gaps as ordinary text, with detailed receipts still available.

The required sandboxed-browser gate now exercises six ordinary requests and expects 38 real receipts; it asserts that the new analysis is visible in the actual production activity transform. This remains ISOLATED until run and cannot establish PRODUCTION acceptance. Exact final counts and identities are recorded in the associated PR after verification.

The full software diagnosis/experiment/repair chain and business readiness/acceptance/delivery/procedure-candidacy chain remain unqualified through ordinary conversation. This extension exposes supported analysis and exact missing prerequisites; it does not represent those broader workflows as completed. No consequential authority changed.

A source-identity RED case showed that reviewing retained quote material assigned a different derived subject. The correction derives the unapproved supplied subject from the original material identity. The same source now retains that identity without creating an opportunity or borrowing approval. Final focused command: `node --import tsx --test tests/conversation-worker.test.ts tests/dashboard-capability-inventory.test.ts tests/owner-job-activity-runtime.test.ts tests/capability-plan.test.ts`: exit 0, 28 passed, 0 failed. The full required local gate is running on this source; exact-head CI, security and served-browser results remain separate proof.


## Exact learning retry boundary follow-up

Reconciled base: PR181 merge `8cd76a03ceb124a698577f7366ae479041008654`, tree `eaafa632932d53f9ddaf67a6464b19206aa8648e`, deployed as `2e62e2a3-9f94-4a74-a929-8a20560ec5fc`. The ordinary owner review previously gave a generic capability blocker for a legacy authorized learning root; the scheduler alone enforced the existing fresh-root limit. A direct kernel worker entrypoint could bypass that scheduler check.

The shared exact-subject predicate now serves the scheduler, kernel reservation gate, final provider dispatch gate and ordinary work review. The existing ceiling remains three failed fresh roots for the same campaign, capability, contract and source job. Child repair remains exempt from this fresh-root rule. No campaign, job, reservation or mandate is replaced. The visible brief names `LEARNING_FRESH_ROOT_RETRY_BUDGET_EXHAUSTED`, the unchanged limit and retained failed-root identities. Long boundary text wraps in mobile activity.

LOCAL / UNIT_TEST RED: two focused cases failed before implementation. The actual authenticated HTTP review lacked the exact retry reason, and direct kernel dispatch returned a failed attempt instead of blocking before dispatch. GREEN command: `node --import tsx --test tests/owner-retry-boundary.test.ts`, exit 0, four passed, zero failed. The cases cover ordinary HTTP receipt-backed analysis, unchanged audit/accounting on blocked dispatch and after reboot, exact identity and child repair boundaries, and a third terminal root failure after reservation but before provider dispatch. That race preserves all four consumed reservations and produces no provider-call-start event for the affected root.

Fixture evidence is explicitly synthetic and isolated: a new temporary directory receives a hash-valid copied legacy history, then normal kernel boot validates it. No application event writer or authentication bypass is exposed. The race fixture initially lacked a reservation for its concurrent root and rejected with `LEARNING_RESERVATION_REQUIRED`; the fixture now includes that existing reservation and requires the exact intended terminal failure and failed job state. An initial typecheck caught use of `findLast` outside the configured ES2022 library; the fixture uses existing supported array operations instead. Neither the compiler configuration nor the acceptance predicate was weakened.

The served-browser gate uses the same isolated legacy state and six ordinary requests / 38 receipts. It requires visible exact retry reasons on desktop and mobile and preservation of three preexisting learning reservations. These are ISOLATED predicates; actual run identities and results are recorded in the associated PR. Full local and exact-head CI/security gates remain required before merge. The reachability inventory remains 93 contracts with the prior explicit restrictions; no new capability or ordinary execution authority is added.

Production owner authentication was still unavailable when this follow-up began. No production conversation success is inferred from isolated tests or startup proofs. The full engineering and business chains identified above remain unqualified. Consequential authority delta: none.

Final LOCAL gate: `npm run verify`, exit 0, 1,380 tests passed, zero failed; 14 HTTP checks passed, zero failed. Strict typecheck, demo and every required integration proof passed. The source was unchanged during the gate. Exact-head CI/security, isolated browser and production state proof are recorded separately in the PR.
