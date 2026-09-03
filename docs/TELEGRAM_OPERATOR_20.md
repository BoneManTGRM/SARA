# SARA bounded Telegram operator

Status: CANARY candidate. Production activation requires an owner-issued action credential and the existing provider hard limit.

## Work card

Objective: let the paired private Telegram owner invoke a deliberately small set of SARA capabilities without transferring owner, financial, deployment, customer-contact, or production authority.

Acceptance criteria:

1. Only the paired private Telegram channel can originate action requests.
2. A dedicated action credential is distinct from the read-only catalog and owner credentials.
3. `/luna` performs one non-stored, OpenAI-only, read-only analysis with a per-request ceiling, daily limit, persistent monthly receipts, and no tool calls.
4. `/task` creates a zero-cost governed self-development work card and performs no execution.
5. `/scaffold` creates a zero-cost work card and compiler-verified isolated SANDBOX scaffold; it cannot promote itself.
6. `/operator-status` exposes only bounded counts and budget state.
7. Replayed Luna request identifiers never make a second paid call.
8. Prompts, outputs, credentials, and provider error bodies are absent from the Railway receipt ledger.
9. The existing $20 monthly model allowance is partitioned so Telegram plus revenue work cannot exceed $20 in total.
10. Outreach, applications, contracts, payments, customer delivery, account creation, merge, deployment, production mutation, and protected authority changes remain unavailable.

## Initial budget partition

- Telegram Luna analysis: at most $2 per UTC month, at most 20 explicit `/luna` requests per UTC day, and at most $0.01 per request.
- Revenue-pilot worker: the remainder of `SARA_MONTHLY_MODEL_BUDGET_USD` after the Telegram allocation.
- Paid requests occur only after an explicit `/luna` command or an already-authorized revenue-pilot job.

The allocation is a usage ceiling, not a promise to spend. Provider hard limits remain the outer circuit breaker.
