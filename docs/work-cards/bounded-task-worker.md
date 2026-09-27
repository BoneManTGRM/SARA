# Bounded task worker

Baseline: 5b6180a4351405b17213afc708fedb8583c05c12. Branch: codex/sara-task-worker-20260927.

Owner direction: implement posted-task earning capabilities, without sales outreach. First supported execution class: supplied dependency-free bounded TypeScript repair packages, using the existing Genome Lab verifier. This is not a general repository shell, a code-generating model, or proof of earnings. No paid calls, dependency installation, external submissions, schedules, account creation, payment changes or production promotion.

Plan: freeze input and original tests; verify failing baseline; test at most three digest-bound existing-file repairs; independently reverify the selected candidate; export exact content/digests with unknown submission, sponsor acceptance and payment. Keep durable start/completion receipts in the canonical audit; an interrupted start never retries silently. Add owner-only API and phone file intake to the current bounty panel. Publish a reviewable candidate after focused tests and the full gate.

Acceptance: reject unsafe paths, missing tests, changed tests, stale/incorrect content digests, oversized packages and more than three proposals. Require a reproduced behavioral failure, not a policy or infrastructure failure. Supplied source/terms are reported claims, not verified repository acquisition or sponsor approval. Recheck owner/stop before every stage. At most one active worker, no retries; cancellation prevents further stages. Persist exact input/result identity and distinguish isolated verification from submission/acceptance/payment. No synthetic fixture becomes a paid opportunity.

Fixed conditions: task-worker-v1, existing Genome Lab source/runtime limits, synthetic fixtures. Minimal case: failing pure TypeScript package plus one wrong and one correct proposal -> original tests preserved -> independently verified candidate export. Critique covers missing/forged evidence, scope, source instructions, stop, concurrent admission and interruption.

Rollback: revert application changes only; keep canonical append-only events and memory. No schema migration or financial/constitutional changes. Deployment requires CANARY qualification and exact-target owner approval per AGENTS.md.

## Review and qualification checkpoint

Independent reviewer: `/root/task_worker_review`, final review found no remaining concrete blocker for the limited supplied-proposal preview. Findings fixed: resource/spawn failures cannot qualify as behavior failures; validate the candidate discriminator; label baseline failures separately from candidate failures; retain cancellation/interrupted receipts; catch completion authorization failures. Historical Genome Lab verifier and acceptance pins remain unchanged.

TDD: `node --import tsx --test tests/task-worker.test.ts` initially failed (exit 1, missing new module). Implemented the minimum fixture, then added owner HTTP, replay, restart, cancellation, resource failure and wrong-proposal regressions. A full run passed 1,613 tests but failed TypeScript because a new test accessed private `state`; corrected it to the existing public detached `inspectAudit`. An earlier environment failure was resolved by locating the existing native checker dependencies. A historical pin regression was resolved by restoring the historical verifier and adapting the canonical builder in the new module instead. Assertions and pins were not weakened.

Browser command: `node --import tsx scripts/qualify-owner-conversation-ui.ts` failed locally with `SANDBOX_BROWSER_UNAVAILABLE`. Desktop/390px phone qualification now exercises actual file intake and durable repair results; execution awaits existing CI. Actual iPhone/WebKit testing has not been performed.

Publication route: CLI push dry run failed due missing HTTPS credentials. Use the authorized GitHub connector and compare the remote tree against the local staged tree. No production deployment or provider activation is authorized by a passing local gate. CANARY qualification and exact-target authenticated owner promotion remain required.

Remaining product work: verified acquisition of a real eligible posted task, fix generation, sponsor-specific acceptance, approved submission and actual payment receipts. This preview accepts prepared JSON packages and cannot produce income autonomously. No paid model calls, external submissions or new services occurred during this change.

Final local gate: `npm run verify` exited 0: 1,613 main tests passed, TypeScript and all integrated proofs passed. Focused worker plus historical pin checks: 13/13, exit 0. Code-file digests and log hashes are retained in `bounded-task-worker-evidence.json`. CI and remote candidate identity will be recorded on the PR.
