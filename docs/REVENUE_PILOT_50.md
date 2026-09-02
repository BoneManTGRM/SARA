# SARA $50 revenue pilot

Status: CANARY runtime candidate. Activation requires the provider and deployment approvals in this work card.

## Work card

Objective: turn the existing public opportunity scout and governed self-build path into the smallest durable opportunity-to-delivery loop that can safely support one standardized paid service.

Observable acceptance criteria:

1. SARA accepts a public opportunity record, rejects automation-prohibited or unsafe scope, and deduplicates it durably.
2. The only initial service is the `$149 Public Repository Readiness Snapshot` with a `$3.00` per-job execution cap.
3. Missing service capabilities become zero-cost self-development jobs whose candidates stop at `SHADOW`.
4. Fulfillment cannot begin until exact realized customer revenue is recorded and the authenticated owner separately approves the job-bound contract target.
5. Director, specialist, verifier, and delivery roles run sequentially through expiring leases and survive restart.
6. The verifier must be a different logical worker from the specialist.
7. A failed verification stops the job; successful delivery preparation stops at owner review with no external delivery authority.
8. The constitutional emergency stop freezes discovery and worker mutations.
9. GPT-5.6 Luna is the default paid worker. Gemini 3.8 Flash is a bounded fallback/challenger, never an automatic authority increase.
10. Every routed call has token, attempt, wall-time, and task-cost ceilings; success and all-route failure both produce durable cost evidence without storing prompts or outputs.

Out of scope for this candidate:

- creating or funding provider accounts;
- changing the Constitution or its `$0` bootstrap target;
- giving a worker owner credentials;
- autonomous outreach, application submission, contracting, collection, refund, merge, deployment, or customer-system access;
- claiming that a generated skill is production-ready before staged evidence and owner promotion;
- adding a second backend, policy authority, ledger, memory system, or dashboard.

## Fixed commercial envelope

| Control | Pilot value |
| --- | ---: |
| Standard service | Public Repository Readiness Snapshot |
| Customer price | `$149` |
| Maximum execution cost per paid job | `$3` |
| Owner-funded monthly operating envelope | `$50` |
| Concurrent paid jobs | `1` |
| Automated external delivery | Disabled |
| Final state | Owner review |

The `$50` value is an operating envelope for this pilot, not a change to the Constitution's protected `$300` ceiling and not a recurring commitment. Provider-side hard limits remain required before any paid runtime or API is activated.

## Logical swarm

The queue records all six roles while paying for no idle agents:

1. `opportunity_scout` records the public source and automation permission.
2. `commercial_analyst` applies the fixed offer, scope, price, risk, and capability gates.
3. `work_director` creates the bounded execution packet.
4. `specialist_worker` produces the work artifact.
5. `independent_verifier` checks it using a different logical worker identity.
6. `delivery_operator` prepares the delivery package and stops at owner review.

Only one post-payment role is leased at a time. A crashed worker can be replaced after its lease expires; stale workers cannot submit against a newer lease.

## Luna-first model routing

The router tries `gpt-5.6-luna` first for every current workload because its paid token rates are lower. It permits at most one `gemini-3.8-flash` fallback attempt. Gemini's free tier is eligible only for data explicitly classified as public and only when the caller opts in; customer-confidential work uses paid routes, while credentials and regulated data fail closed before any provider call.

Each task is preflighted against a fixed input ceiling, output ceiling, declared client wall time, remaining lease duration, whole-cent task allowance, and the job's remaining `$3` cap. Failed calls are charged conservatively at the planned worst case. Durable receipts contain provider, model, billing mode, reasoning level, token counts, cost, outcomes, and a digest—not prompt text, generated output, credentials, or provider error bodies.

The current implementation includes bounded adapters for OpenAI's Responses API and Google's Interactions API. When `OPENAI_API_KEY` is explicitly configured, the persistent operator wakes only for a collected-revenue job with target-bound owner fulfillment approval. It runs one logical role at a time, saves each private output to durable storage before advancing the job, uses a different worker identity for verification, and stops the final package at owner review. Provider project limits remain the outer circuit breaker.

## Skill learning

The first service requires four explicit capabilities:

- `public-repository-inventory`
- `readiness-analysis`
- `independent-report-verification`
- `delivery-package-generation`

When any are absent, the opportunity remains at owner review and SARA creates a `$0` self-development work card for each gap. Those cards reuse the existing Genome Lab path: candidate source, isolated behavioral verification, digest-bound evidence, draft review, and a hard stop at `SHADOW`. Merely generating a candidate does not register it as available.

## Activation boundary

Before the loop can perform real customer work, the owner must provide all of the following as separate, explicit actions:

1. Approve the exact provider commitments and hard limits. The Luna-first starting allocation is Railway `$10`, OpenAI `$10`, contingency `$5`, and uncommitted reserve `$25`. Gemini paid spend starts at `$0` until measured results justify it.
2. Create a dedicated owner-controlled OpenAI API project and credential with a `$10` hard limit. Add a Gemini credential only for the explicitly approved public-data fallback or later paid challenger evaluation.
3. Create or select a dedicated SARA Railway project, attach durable storage, set Railway's project hard limit, and keep the service private unless an authenticated ingress is deliberately approved.
4. Set `SARA_OWNER_TOKEN_SHA256`, `SARA_STATE_DIRECTORY`, `SARA_HOST=0.0.0.0`, `SARA_MONTHLY_MODEL_BUDGET_USD=10`, and the separately managed `OPENAI_API_KEY` through the provider secret/configuration interface. `SARA_LIVE_PROOF_ON_START=true` authorizes one persisted, fail-closed connectivity proof of no more than `$0.01`; leave it unset for normal deployments. Set `GEMINI_API_KEY` only if the fallback is enabled. Never commit a token, API key, or plaintext owner credential.
5. Verify and promote each required capability through the existing staged mutation path.
6. Bind an owner-controlled business email and payment destination under a separate mandate. Twilio or another messaging provider is optional and should remain disabled until a real service needs it.

The local service remains runnable with `npm start`; the full repository gate remains `npm run verify`.
