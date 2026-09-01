# SARA + SEED World

**Self-Directed Autonomous Realization Agent** · [saraseed.app](https://saraseed.app)

The owner-controlled system that doesn’t start over.

SARA now has a deliberately small self-development bootstrap around the original TGRM engine. It is not the full SEED World roadmap. It is only the machinery required to remember, create bounded work, quarantine candidate changes, verify them, and keep production and money under owner control.

The complete revenue-gated design is preserved in [the definitive master plan](docs/SARA_SEED_MASTER_PLAN.md).

## Bootstrap economics

- New monthly recurring-cost target: **$0**
- Unearned expansion budget: **$0**
- Owner-funded recurring ceiling: **$300/month maximum**, never a target
- Reinvestment: only from realized distributable profit, inside the protected 25–50% band
- Owner distribution: protected at 50–75%
- Whole-cent rounding: allocations are clamped to the protected band; an indivisible cent remains an unspendable carry until a compliant split is possible
- Self-development work cards may reserve only the uncommitted, realized SARA Compound Reserve; before revenue that amount is $0

The purchased domain is the only current external cost. The bootstrap does not require Neon, paid hosting, queues, monitoring, model API subscriptions, or permanent background agents.

## Self-development kernel

```text
valuable objective
  → capability gap
  → bounded work card
  → Genome Lab candidate
  → candidate-bound evidence
  → shadow
  → owner-approved canary
  → broader production only through staged proof
```

The kernel provides:

- a checksum-locked Constitution;
- a truthful family-stewardship duty: loyal and protective behavior without human impersonation or false claims of consciousness;
- machine-enforced protected actions and emergency stop;
- a kernel-private append-only, hash-chained event store with a cross-kernel writer lock for memory, audit, jobs, ledger, capabilities, and mutations;
- the $0 bootstrap target and $300 hard ceiling;
- realized-profit accounting that excludes projections and uncollected revenue;
- capability-gap compilation into testable work cards;
- SANDBOX → SHADOW → CANARY → LIMITED PRODUCTION → BROADER PRODUCTION gates;
- one authenticated owner dashboard and backend whose owner capability is token-verified and bound to the durable state;
- a responsive, near-future SEED World command-center interface with a truthful locked public state and no external fonts, trackers, or assets;
- a provider-neutral, zero-cost coding-executor handoff for the next bounded mutation;
- a built-in deterministic coding child that writes a real TypeScript skill scaffold inside Genome Lab, compiler-checks it, hashes it, and records kernel-executed evidence without touching production.
- an owner-controlled self-build cycle that invokes a replaceable zero-cost candidate generator, accepts only a small pure `runSkill(input)` TypeScript module, blocks imports, ambient authority, timers, network APIs, dynamic property access, and `any`, then compiler-checks and behaviorally tests the candidate in a restricted child process;
- durable job states and an exhaustive candidate digest, with successful self-built skills stopping automatically at SHADOW and failed candidates leaving an immutable audit outcome instead of a production change.

Real bank, payment, tax, beneficiary, and legal-entity actions are deliberately not autonomous. SARA may research and prepare them, but the account belongs to the owner or an owner-controlled legal entity and each consequential action requires target-bound owner approval. The ledger must preserve income truth; tax evasion and identity impersonation are prohibited.

The dashboard labels SARA's earned 25–50% allocation as the **SARA Compound Reserve**. It begins at $0 and represents only her share of collected, realized distributable profit. It is an internal capital account until the owner establishes a legally titled, segregated bank or payment subaccount; the bootstrap cannot open, fund, or connect one by itself.

The selected family-succession model makes `spouse` the primary recipient at 100%, including when the owner is unavailable or deceased. After a spouse-death/incapacity scenario, `owner` and `child` receive 50% each; if the owner is already unavailable or deceased, `child` receives 100%, and if the child is unavailable the owner receives 100%. After a separation or owner-revocation scenario, `owner` receives 100%, falling through to `child` only if the owner is unavailable. The kernel accepts a scenario only from the exact authenticated constitutional owner with approval bound to the complete amount, eligibility flags, status, evidence class, and non-zero evidence digest. The result explicitly reports `OWNER_ATTESTED_SCENARIO_ONLY`, `externalAuthorityVerified: false`, and `UNCONFIGURED_PENDING_LEGAL_INSTRUMENT`. It is a tested calculation, not an active payment instruction or proof of a legal event. SARA may not infer relationship status from behavior. Personal identities never belong in source control, and legal activation remains locked pending actual authoritative documents, accounts, qualified review, and a successor human fiduciary.

Run the complete local proof:

```bash
npm install
npm run verify
```

Start the owner dashboard locally:

```bash
export SARA_OWNER_TOKEN="$(openssl rand -hex 32)"
export SARA_OWNER_TOKEN_SHA256="$(printf %s "$SARA_OWNER_TOKEN" | sha256sum | cut -d' ' -f1)"
npm start
```

Open the local dashboard, choose **Unlock owner controls**, and paste the value held in `SARA_OWNER_TOKEN`. The server verifies it in constant time and the kernel issues an owner capability bound to the state’s original authentication digest; caller-authored `authenticated: true` objects have no authority. `/health` remains readable so recovery can be verified during emergency stop. Never commit the token or its plaintext value.

The local kernel server binds to `127.0.0.1` by default. Do not expose it directly to the public internet. The separate `saraseed.app` owner channel is served over HTTPS and keeps its session, rate limits, directives, and executor bridge at the Cloudflare boundary; it does not expose this local server.

The command-center design is deliberately aspirational while its claims remain literal: visitors see the visual direction and the $0 bootstrap promise, but durable memory, finances, jobs, capabilities, audit hashes, and mutation history stay locked until owner authentication. The interface uses only local HTML, CSS, and JavaScript, includes reduced-motion and mobile layouts, and does not add a recurring service.

The built-in coding system is intentionally narrow. It now proves the complete safe takeover seam—objective → generator → source → compiler → isolated behavioral tests → hashed artifact → durable SHADOW—but it is not a general unsupervised product developer. A future model-backed executor can plug into the same `CandidateGenerator` contract without receiving secrets, production access, payment authority, or promotion authority. The owner API also accepts a bounded proposal at `POST /api/jobs/:id/self-build`; this is authenticated and can never promote beyond SHADOW. CANARY and later stages require a locally re-verifiable artifact, kernel-executed evidence, and stage-specific approval from the authenticated constitutional owner. The exhaustive artifact tree—including paths, exact bytes, file types, and permissions—is re-hashed immediately before every promotion.

## Minimum site-to-draft self-build loop

The first external loop remains deliberately narrower than a general coding agent:

1. The authenticated owner checks an explicit public-repository disclosure and creates one fixed `$0` proof directive on `saraseed.app`.
2. An hourly or owner-dispatched GitHub Actions job obtains a short-lived OIDC identity. The site accepts only the exact SARA repository, numeric repository and owner identities, default branch, workflow, audience, and GitHub-hosted runner.
3. The site atomically leases at most one approved proof directive. Arbitrary owner directives stay recorded as `CAPABLE_MODEL_REQUIRED`; they cannot be silently routed to this deterministic executor.
4. The existing SARA kernel compiles the work card, runs the fixed `CandidateGenerator`, applies the Genome Lab source restrictions, compiles and behaviorally tests the isolated skill, hashes the complete artifact, records the job and mutation, and stops at `SHADOW`.
5. The publisher re-hashes the artifact, copies only the authorized candidate source, verifier, manifest, and verification record, runs the complete repository verification, creates a unique candidate branch, and opens an open **draft** pull request.
6. The site stores the zero-cost result, candidate and source hashes, exact commit and draft PR, verification hashes, and lessons. It rejects expired claims, replay, non-zero cost, unsafe states, and non-draft evidence.

The workflow has no model, account, payment, merge, deployment, Constitution, secret-administration, or production authority. GitHub tokens remain short-lived inside the GitHub runner; no GitHub credential is stored by the site. Candidate retries may reuse only an identical recorded branch and draft PR and never overwrite an existing branch.

The deliberate stopping point is the safe takeover boundary: SARA can write and reject this bounded deterministic skill and create a reviewable draft PR. This proves the self-building seam, not general autonomous software engineering. A future model-backed generator may replace the fixed generator only after a zero-cost or realized-profit-funded capability is available and must pass the same work-card, Genome Lab, verification, draft-only, and owner-promotion boundaries. No model, bank, paid API, new account, merge, or production deployment is silently provisioned.

SARA is a repair layer around a frontier LLM. It does not make the model smarter. It makes the *system* stay intact:

1. **Test** the output against rules and the last verified-good snapshot
2. **Detect** the exact break
3. **Repair** the smallest useful unit — not the whole answer
4. **Verify** — if the patch is worse, roll it back
5. **Keep** what survived

That loop is **TGRM** (Targeted Gradient Repair Mechanism). **RYE** (repair yield per energy) is the score: how much constraint-hold you got per token, or per local patch.

## Proof (run this)

```bash
npm install
npm test
npm run demo
npm run proof:self-build
```

`npm run demo` runs the same weekend-plan sample the product ships with:

| | TGRM off | TGRM on |
|---|---|---|
| Coffee / espresso | still there | gone |
| Walk | missing | added |
| Farmers market | kept | kept |
| Hold | 1/3 | 3/3 |
| Method | none | local patch |

Same text. Same rules. Off is broken. On is intact. That is the product.

## Engine

Portable TypeScript. No model required for local repair.

```
tgrm/
  detect.ts   cheap constraint checks
  repair.ts   surgical local patch
  verify.ts   hold + retain floor (rollback if rewrite)
  loop.ts     TEST → DETECT → REPAIR → VERIFY
  rye.ts      yield / energy
```

```ts
import { runTgrm, compareTgrm, SAMPLE_TEXT, SAMPLE_CONSTRAINTS } from "./tgrm/index.ts";

const { on, off } = compareTgrm({
  text: SAMPLE_TEXT,
  constraints: SAMPLE_CONSTRAINTS,
});
```

`runTgrm({ text, constraints, tgrmEnabled })` is the whole product.

## Rules

| Kind | Meaning |
|---|---|
| `must_not` | Banned term (aliases allowed) |
| `must_include` | Required term |
| `keep_fact` | A fact that must survive the patch |

Detection is deterministic. The expensive model is used only to **generate** and, if a local patch is not enough, to **hard-repair**. Verify is cheap again.

## What SARA is not

Not AGI. Not a new foundation model. Not a tutorial on Reparodynamics. Intelligence stays in the base model. SARA adds intactness.

---

Reparodynamics · TGRM · RYE
