# Wave 2: bounded troubleshooting

Implement six deterministic, zero-network capability contracts in the existing digital capability registry. They analyze supplied evidence and draft diagnostic/recovery decisions; no output grants authority, executes work, retries a request, releases reservations, or changes a job. Existing kernel receipts provide persistence and audit.

Acceptance: cluster repeated signatures without inventing proven common roots; rank discriminating safe experiments; deny blind retries for deterministic/auth/policy/budget failures and uncertain external completion; reconstruct continuation only from trusted durable kernel snapshot, preserving completed steps and accounting; resolve dependency roots/cycles with exact blocker classes; produce actionable owner escalation with evidence and explicit missing facts. Empty/malformed/contradictory/duplicate/injection inputs must fail closed. Frozen examples, deterministic outputs, and focused adversarial tests qualify contracts.

Recovery snapshot integration: caller JSON cannot provide trusted completion. Parent kernel may project existing durable state into optional execution context; no new store. A supplied journal alone returns EVIDENCE_REQUIRED. Replay safety requires current snapshot digest in receipt identity.

RED: test import of missing troubleshooting definitions fails before implementation. Verification commands and outcome are recorded after GREEN.

## Local verification

- RED `node --import tsx --test tests/troubleshooting.test.ts`: exit 1, missing troubleshooting definitions module, before implementation.
- GREEN same command: exit 0, 9 tests passed / 0 failed, including 14 frozen qualification scenarios checked for deterministic output and schema conformance.
- `npm run typecheck`: Wave 2 files clean; concurrent secretary work initially lacked its definitions module. Parent performs the final integrated typecheck and full `npm run verify` once all wave files are complete.
- Tested malformed closed schemas, caller authority injection, contradictory duplicate event IDs, subsystem separation, line-normalized signatures, denial/attempt/budget/completion retry limits, unknown hypotheses, production diagnostic rejection, accounting preservation, uncertain external effects, stale snapshot revision, supplied snapshot laundering, dependency cycles/shared roots, vague escalations and absent evidence.

## Integration boundaries

Parent owns registry registration, trusted recovery snapshot projection from the existing kernel store, live snapshot digest receipt invalidation, and integrated restart/backup/runtime proof. Local recovery serialization test is not a claim of actual production crash recovery. All six implementations make zero network calls and no filesystem mutations. All outputs preserve explicit uncertainty; supplied text cannot mint owner authority. No capability independently executes a retry, external diagnostic, job transition or notification.
