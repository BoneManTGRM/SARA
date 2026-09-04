# SARA Reparodynamic Intelligence Runtime — implementation plan

## Goal and claim boundary

Luna generates intelligence. Reparodynamics controls improvement. Deterministic systems verify. Memory retains only proven lessons. Stronger-model compute is spent only when evidence justifies it.

This project tests whether SARA + GPT-5.6 Luna + Reparodynamics outperforms the same Luna without Reparodynamics. It does not claim to alter Luna's foundation-model weights or intrinsic intelligence. Performance claims require frozen matched trials and reproducible proof.

## Delivery status

| Range | Status in this change | Gate |
|---|---|---|
| Phases 0–6 | SHADOW foundation implemented | Full deterministic verification and review |
| Phase 7 | In-memory receipt chain implemented; durable persistence not yet implemented | Kernel hash-chain design and crash-resume tests |
| Phases 8–10 | Policy and generator seams implemented; live Luna adapter and activation remain gated | Strict provider schema, durable receipts, authority and benchmark evidence |
| Phases 11–17 | Planned | Separate domain verifier and authority review |
| Phases 18–27 | Planned | Frozen benchmark corpus; no live spend by default |
| Phases 28–32 | Planned | Proven Luna A/B result before model/external comparisons |

Passing this change does not activate CANARY, spend model budget, or substantiate a performance advantage.

## Phases 0–10 — bounded coding foundation

### 0. Freeze the contract

Use TypeScript in Genome Lab, GPT-5.6 Luna, unchanged authority, SHADOW maximum, compiler + behavior + policy + integrity verification, smallest repair first, evidence-only learning, and Luna-vs-identical-Luna A/B. Initial limits are 3 cycles, 2/80 surgical files/lines, 6/240 deep files/lines, and $0.15 repair spend. Never auto-merge, deploy, mutate protected paths, or bypass verification.

### 1. Structured code failures

Keep `tgrm/` as the portable text engine. Add a parallel code protocol covering syntax, type, test, behavior, policy, security, integrity, timeout, and unknown failures. Each signal carries stable code/location, evidence digest, fingerprint, severity, and preexistence.

### 2. Genome Lab oracle

Return `ProgramVerificationResult` with score, artifact digest, structured failures, completed checks, and evidence digests. The oracle answers what failed, what remained good, whether the repair improved the candidate, and whether it regressed a prior check. Behavior acceptance is independent input; absence cannot produce PASS.

### 3. Locality and energy

Measure files, changed lines, diagnostic locality, dependency spread, failed tests, module boundaries, protected paths, tokens, dollars, runtime, and cycles. Select deterministic, Luna surgical, Luna deep, challenger, or stop. Thresholds are tunable parameters, not constants inferred from the simulator.

### 4. Strict Luna repair contract

`SARA_CODING_REPAIR_V1` receives only the objective, acceptance criteria, artifact/file digests, relevant bounded source, exact fingerprints, preserved checks, limits, verified lessons, and Constitution digest. It returns whole-file replacements bound to expected digests. Unknown/stale files, tests, packages, commands, networks, deployments, authority requests, and protected paths are rejected.

### 5. Controller

Verify the baseline; fingerprint failure; recall verified lessons; select strategy; request a proposal; apply to an isolated copy; measure blast radius; verify; retain only monotonic improvement; otherwise roll back; stop at clean, cost, cycle, risk, or debt bounds. Model prose can never constitute success.

### 6. Champion state

Use BASELINE → PROVISIONAL_CHAMPION → VERIFIED_CANDIDATE. A worse later cycle cannot destroy the best verified improvement.

### 7. Receipts

Every cycle records before/proposal/after digests, fingerprint, strategy, actual files/lines, verifier evidence, token/cost accounting, RYE, outcome, and reason. Before Phase 10 activation, move receipts into the kernel's existing hash-chained store and prove crash-resume and tamper rejection.

### 8. RYE

Calculate normalized verification gain divided by dollars plus line and runtime penalties. RYE can rank acceptable strategies but never override security, policy, authority, verification, integrity, or cost.

### 9. CandidateGenerator integration

Wrap the existing generator rather than creating a second self-build system. SHADOW runs the sidecar but returns the base proposal unchanged. CANARY may return only a fully verified repaired proposal; the kernel and Genome Lab independently re-verify it and still stage only SHADOW.

### 10. Modes

`SARA_REPARODYNAMIC_CODING_MODE=off|shadow|canary`; default off. Environment configuration does not grant spending or promotion authority.

## Phases 11–17 — learning and broader control

### 11. Domain reuse

Apply the control structure—not the coding verifier—to research claims, documentation requirements, NICO claim support, secretary constraints, and business decisions. Every domain must supply its own independent oracle.

### 12. Verified repair memory

Store language, task family, fingerprint, toolchain and acceptance digests, strategy, result, cycles, blast radius, cost, RYE, evidence, and invalidation conditions. Exclude private code, prompts, model output, credentials, and secret-bearing traces.

### 13. Recurrence debt

First occurrence repairs and learns; second reuses the lesson then escalates if needed; third marks a detector/lesson/verifier defect and stops normal retries.

### 14. Skill distillation

Repeated verified repair patterns become deterministic skill candidates, pass Genome Lab behavioral tests, remain SHADOW, and require owner promotion.

### 15. Evidence-driven model escalation

Deterministic → Luna → surgical → deep → challenger → Sol → human/fail closed. Escalate only for measured no-progress, recurrence, ambiguous criteria, verifier disagreement, high blast radius, security criticality, or positive expected value.

### 16. Independent verification

Prefer compilers, hidden tests, static analysis, policy, digests, and NICO. Different prompts to the same model are logical separation, not independent foundations. Semantic work should use a different model/evidence packet when deterministic proof is unavailable.

### 17. NICO integration

Use NICO for security-sensitive, release-level, architectural, external-customer, or authority-boundary changes—not every small patch. The path remains repair → Genome Lab → SHADOW → warranted NICO assessment → required authorization → CANARY.

## Phases 18–27 — controlled A/B evidence

### 18–20. Harness, corpus, metrics

Create a frozen matched harness with Reparodynamics off/on and identical model, source, commit, objective, criteria, context, tests, verifier, environment, authority, and budget. Start with 30 tasks: ten synthetic deterministic failures, ten reconstructed SARA defects without secrets, and ten immutable licensed public TypeScript tasks. Measure verified completion, first/eventual pass, critical/escaped regression, time, cost, tokens, cycles, rollbacks, blast radius, rewrites, RYE, and lesson reuse. Primary metric: verified completed tasks per active execution time.

### 21–23. Gauge, evidence levels, statistics

Generate—not hand-enter—the dashboard gauge. Evidence levels are SIMULATED, LAB (<30 matched real tasks), MEASURED (30+), REPLICATED (100+ across 3+ material repository/task classes), and STALE. Calculate matched-pair bootstrap 95% confidence intervals. If an advantage interval crosses zero, state that no advantage is proven.

### 24–25. Auditability and invalidation

Every pair binds case/repository/commit/criteria/model/baseline/experiment/verifier/environment/completion digests. Proof exposes aggregate inputs and receipts when privacy permits. Mark results STALE when the model ID, controller, policy, verifier, compiler, runtime, corpus, method, or toolchain changes.

### 26–27. Anti-gaming and history

Freeze benchmark versions by digest. Never remove hard cases, selectively rerun baseline failures, change budgets/context/tests/criteria, count self-report, expose hidden answers, or replace failed pairs. Preserve immutable performance snapshots linked to their proof digests.

## Phases 28–32 — comparisons and system expansion

### 28. Sol comparison

Only after Luna A/B proof, compare Luna, Luna + Reparodynamics, Sol, and Sol + Reparodynamics under identical conditions.

### 29. External-agent comparison

Compare Codex, Claude Code, and other systems only with identical starting source, acceptance criteria, verifier, environment, and comparable time accounting. Never claim superiority across unmatched conditions.

### 30. Promotion gates

SHADOW requires all old/new tests, typecheck, integrated verify, tamper rejection, cost enforcement, rollback, and protected-path protection. CANARY additionally requires 30 matched tasks, a positive 95% interval for a major benefit, no critical-regression increase, 100% cost/digest/protected-path enforcement, crash-resume proof, and either ≥15 percentage-point verified-success gain or ≥25% cost reduction at equivalent success. Broader production should require 100+ replicated tasks across 3+ families, repeated stability, NICO assessment, owner approval, and rollback drill.

### 31–32. Cognition loop and architecture

Generalize Observe → Test → Detect → Localize → Repair → Verify → Rollback/Retain → Learn → Distill across SARA only after the coding experiment proves the architecture. The verifier changes by domain; owner authority does not.

## Implementation sequence

1. Failure protocol; 2. oracle; 3. policy; 4. strict schema; 5. controller; 6. generator wrapper; 7. SHADOW; 8. durable memory/receipts; 9. recurrence debt; 10. distillation; 11. 30-task A/B; 12. gauge and proof; 13. confidence intervals; 14. CANARY; 15. 100-task replication; 16. Sol; 17. external agents; 18. non-coding domains.

## Commands

- `npm run proof:reparodynamic-coding` — deterministic offline proof included in `npm run verify`.
- `npm run benchmark:coding:offline` — zero-model-cost fixture proof until the frozen corpus lands.
- `npm run benchmark:coding:live` — manual and fail-closed until corpus, budget, and authority are configured.

## Success criterion

Success is a reproducible, statistically supported increase in verified correct work per dollar, token, and active unit of time. SARA must generate all reported numbers and bind them to inspectable proof. Until then, no performance multiplier is claimed.
