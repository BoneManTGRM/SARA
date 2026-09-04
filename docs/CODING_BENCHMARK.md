# SARA Reparodynamic coding measurement protocol

## Current implementation boundary

PR #43 added durable Reparodynamics learning and memory. PR #55 connected SARA's real GPT-5.6 Luna coding worker to the bounded repair controller, added durable cycle receipts, isolated TypeScript and behavioral verification, cost/time/RYE measurement, and rollback. Its merge commit is `1899d15e306220800943df021c439377cf130b8d`.

PR #52 was an older SHADOW-only foundation and is closed as superseded. It must not be merged.

Reparodynamics is already active for bounded coding repair when `SARA_REPARODYNAMIC_CODING_MODE=canary`. The remaining SHADOW boundary applies to the resulting repository mutation: generated code still cannot merge, deploy, or promote itself.

This measurement layer does not rebuild that integration. It determines whether the existing Reparodynamic controller produces a reproducible improvement over the same Luna repair worker without the controller.

## Matched comparison

Each frozen case runs two independently recorded arms against the same starting program, objective, acceptance criteria, model route, verifier, environment, authority, and spend limits:

1. `luna`: one bounded Luna repair proposal followed by deterministic verification.
2. `luna_reparodynamic`: the same Luna repair contract under the existing controller, with up to three bounded Test → Detect → Repair → Verify cycles, monotonic champion retention, and rollback.

Arm order alternates by pair index to reduce ordering bias. A failed or interrupted arm is preserved rather than selectively removed or silently rerun. The paired result is finalized only after both immutable arm receipts exist.

## Recorded evidence

Every arm records verified completion, final verification score, active execution time, accounted model cost, input/output tokens, cycles, rollbacks, changed files and lines, RYE, regressions, critical regressions, failure code, final artifact digest, and verifier evidence digests.

Every pair is bound to digests for:

- source revision
- frozen corpus
- model route
- controller implementation
- repair policy
- verifier implementation
- runtime environment and toolchain
- target-bound owner authority

Receipts are written before the next paid arm begins. Identical retries are idempotent. Conflicting or tampered evidence is rejected. An interrupted benchmark resumes only the missing arm or pair.

## Generated analysis

SARA generates aggregate normal-versus-Reparodynamic metrics and deterministic matched-pair bootstrap 95% confidence intervals for:

- verified-success difference
- final-score difference
- verified completions per active second
- relative cost reduction when both costs are known

The proof digest binds the summary to the complete set of pair digests. Mixed or changed source, corpus, model, controller, policy, verifier, environment, or authority bindings make the evidence `STALE`.

## Evidence levels

- `SIMULATED`: one or more pairs were not live model executions.
- `LAB`: fewer than 30 matched live pairs.
- `MEASURED`: at least 30 matched live pairs under one current evidence binding.
- `REPLICATED`: at least 100 matched live pairs across at least three material task classes and three task families.
- `STALE`: the evidence bindings are mixed or no longer match the expected implementation.

The included version-one corpus contains ten internally authored synthetic TypeScript failures. It is intentionally marked `LAB_SYNTHETIC_ONLY` and `promotionEligible: false`. It verifies the harness but cannot establish a general coding-speed or coding-accuracy advantage.

A performance claim still requires a frozen 30-case corpus containing ten synthetic cases, ten reconstructed SARA defects without secrets, and ten immutable licensed public TypeScript cases. Repeated evidence for broad/default use requires 100 or more cases across at least three material classes.

## Promotion recommendation policy

This layer only emits a recommendation. It never changes the production environment or mutation authority.

It recommends immediate rollback to SHADOW if critical regressions increase or a verified-success decrease is statistically supported. It holds on stale, simulated, LAB, or inconclusive evidence.

A staged canary expansion requires current `MEASURED` or `REPLICATED` evidence and either:

- at least a 15 percentage-point verified-success increase with a positive lower 95% confidence bound, or
- at least a 25% cost reduction with equivalent verified success and a lower 95% confidence bound of at least 25%.

Expansion recommendations are staged at 5%, 20%, 50%, and 100%. Reaching 100% requires `REPLICATED` evidence. Eligibility to make Reparodynamics the default requires at least 150 current replicated pairs while the major benefit remains supported. Every production promotion remains a separate target-bound owner-authorized action.

## Offline verification

The full no-spend evidence chain is part of `npm run verify`:

```sh
npm run proof:coding-benchmark
```

This exercises matched execution, per-arm persistence, pair completion, summary generation, promotion hold, snapshot persistence, proof binding, and crash-resume loading without calling a model.

## Explicit live LAB run

The live runner is manual and fail-closed. A ten-case run has a maximum authorized cap of $3.00 because each of two arms may consume up to $0.15 per case. The actual accounted cost may be lower.

```sh
OPENAI_API_KEY='<credential>' \
SARA_CODING_BENCHMARK_AUTHORITY_SHA256='<target-bound-approval-digest>' \
SARA_CODING_BENCHMARK_SOURCE_REVISION='<immutable-git-revision>' \
npm run benchmark:coding:live -- \
  --acknowledge-lab-only \
  --benchmark-id '<uuid-v4>' \
  --max-spend-usd 3.00 \
  --current-canary-percent 5 \
  --case-count 10
```

The command refuses to start without the explicit live flag supplied by the package script, LAB-only acknowledgement, immutable source revision, target-bound authority digest, model credential, complete-pair budget, and valid case bounds. It stops before the next arm if the cap would be exceeded. Unknown spend is preserved as evidence and blocks further paid execution.

Do not interpret a successful ten-case run as a general multiplier. Its honest result is LAB evidence from an internally authored synthetic corpus, followed by a `hold` recommendation.
