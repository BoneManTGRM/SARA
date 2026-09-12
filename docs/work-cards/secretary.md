# Secretary capabilities

Implement ten bounded deterministic secretary capabilities through the existing capability contract and durable kernel receipt path. Inputs are supplied communication data, never authority. No transmission, calendar mutation, code execution, customer promise, payment, or approval is performed.

Acceptance: explicit commitments retain message provenance; conditional language remains uncertain; follow-up preserves unanswered questions; explicit dates/times parse without inventing a timezone; owner decisions require authenticated owner execution; supersession references must resolve to trusted kernel receipts and history is not rewritten. Drafts and briefs derive only from supplied facts. Attachments accept extracted text only and never execute content. Frozen cases and focused negative tests must validate strict schemas, deterministic outputs, duplicate handling, injection boundaries, and uncertainty. Parent integration qualifies real kernel persistence/restart/restore and runtime evidence.

Limitations: deterministic English heuristics do not provide exhaustive semantic understanding. Relative dates and implied obligations require clarification. Supplied facts do not prove external state.

## Local qualification evidence

- RED: `node --import tsx --test tests/secretary-capabilities.test.ts` exited 1 because the requested implementation module was absent.
- GREEN: the same command passed 10 tests, including 22 frozen predicates with deterministic replay and closed output schema validation.
- Integration RED: `node --import tsx --test tests/secretary-kernel.test.ts` passed 0/2 before registry integration; the first missing contract was `support-intake-triage`.
- Integration GREEN after shared registry integration: the same command passed 2/2, invoking all ten real contracts and proving owner authentication, exact-scope owner decision supersession, rejection of unsupported prior history, immutable old decisions, commitment records, process boot recovery, copied backup restoration, idempotency and audit-prefix preservation.
- Full CI and production safe-runtime acceptance are parent integration gates; this local evidence does not claim them.

Decision supersession takes the original result digest in `supersedesReceiptId` and requires that digest in `evidenceReceiptIds`. The kernel resolves actor-visible digest-validated historical receipts. A superseding decision must reference a successful authenticated owner decision for the same exact scope with no later decision timestamp. The prior record is retained unchanged.
