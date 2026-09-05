# SARA Reparodynamic coding measurement protocol

## Current implementation boundary

PR #43 added durable Reparodynamics learning and memory. PR #55 connected SARA's real GPT-5.6 Luna coding worker to the bounded repair controller, added durable cycle receipts, isolated TypeScript and behavioral verification, cost/time/RYE measurement, and rollback. Its merge commit is `1899d15e306220800943df021c439377cf130b8d`.

PR #52 was an older SHADOW-only foundation and is closed as superseded. It must not be merged.

Reparodynamics is already active for bounded coding repair when `SARA_REPARODYNAMIC_CODING_MODE=canary`. The remaining SHADOW boundary applies to the resulting repository mutation: generated code still cannot merge, deploy, or promote itself.

This measurement layer does not rebuild that integration. It compares the existing Reparodynamic controller with a conventional bounded patch-and-memory loop on the same SARA framework. Both deliberately share policy, lesson representation and prompt machinery. This is not an all-Reparodynamics-off control or evidence of a unique framework-wide advantage.

## Matched comparison

Each frozen case runs two independently recorded arms against the same starting program, objective, acceptance criteria, Luna route and implementation, verifier, environment, authority, and spend limits:

1. `luna`: up to three bounded proposals in a conventional best-so-far patch-and-memory loop, with last-two failure lessons, exact duplicate protection, monotonic champion retention and rollback.
2. `luna_reparodynamic`: the same Luna repair contract under the existing controller, with up to three bounded Test → Detect → Repair → Verify cycles, monotonic champion retention, and rollback.

Both arms independently reverify the retained final artifact, including an already-clean starting artifact. An unstable final result is recorded as unfinished. The same finite spend ceiling, safe integer call/file/line limits and protected paths are snapshotted before callbacks. Cases, contexts and bindings are also snapshotted before the first arm. Unspecified execution is `simulated`, never implicitly live.

Arm order alternates by pair index to reduce ordering bias. A failed or interrupted arm is preserved rather than selectively removed or silently rerun. The paired result is finalized only after both immutable arm receipts exist and exactly match the pair.

## Recorded evidence

Every arm records verified completion, final verification score, active execution time, accounted model cost, input/output tokens, cycles, rollbacks, changed files and lines, RYE, regressions, critical regressions, failure code, final artifact digest, and verifier evidence digests.

Every pair is bound to digests for:

- exact clean source revision
- frozen corpus
- Luna route and adapter/client/router implementation
- controller implementation
- repair policy
- verifier implementation
- runtime environment and toolchain
- target-bound owner authority

Receipts are written before the next paid arm begins. Identical receipt writes are idempotent; this does not authorize repeating a model request. Conflicting, orphaned, cherry-picked, or tampered evidence is rejected. The live CLI first consumes a private durable one-use execution claim for the entire experiment. Successful and interrupted invocations cannot resume paid work. A missing receipt may represent an already-charged request and never authorizes a rerun. Read-only evidence loading remains available. Retain the same private local state directory: privileged deletion, copied ledgers and network filesystems are outside this guard's guarantees.

## Generated analysis

SARA generates aggregate normal-versus-Reparodynamic metrics and deterministic matched-pair bootstrap 95% confidence intervals for:

- verified-success difference
- final-score difference
- verified completions per active second
- relative active-time reduction
- relative cost reduction when both costs are known

The proof digest binds the summary to the complete set of persisted pair digests. Historical one-proposal controls remain historical and must not be relabeled or pooled with this retry-and-memory control. Mixed or changed source, corpus, model, controller, policy, verifier, environment, or authority bindings make the evidence `STALE`.

## Evidence levels

- `SIMULATED`: one or more pairs were not live model executions.
- `LAB`: live evidence that does not meet the balanced minimum below.
- `MEASURED`: at least 30 matched live pairs, including at least ten synthetic cases, ten reconstructed SARA defects, and ten immutable licensed public cases, under one current evidence binding.
- `REPLICATED`: at least 100 matched live pairs while retaining at least ten cases from each material task class and at least three task families.
- `STALE`: the evidence bindings are mixed or no longer match the expected implementation.

The included version-one corpus contains ten internally authored synthetic TypeScript failures. It is intentionally marked `LAB_SYNTHETIC_ONLY` and `promotionEligible: false`. It verifies the harness but cannot establish a general coding-speed or coding-accuracy advantage.

A performance claim still requires the balanced frozen 30-case corpus described above. Repeated evidence for broad/default use requires 100 or more cases across the material classes and multiple task families.

## Promotion recommendation policy

This layer only emits a recommendation. It never changes the production environment or mutation authority.

It recommends immediate rollback to SHADOW if critical regressions increase or a verified-success decrease is statistically supported. It holds on stale, simulated, LAB, or inconclusive evidence.

A staged canary expansion requires current `MEASURED` or `REPLICATED` evidence, at least 80% treatment verified success, no increase in noncritical regressions, and at least one of these supported benefits:

- at least a 15 percentage-point verified-success increase with a positive lower 95% confidence bound;
- at least a 25% active-time reduction at equivalent verified success, with a lower 95% confidence bound of at least 25%; or
- at least a 25% cost reduction at equivalent verified success, with known costs for every matched pair and a lower 95% confidence bound of at least 25%.

Equivalent verified success means the point estimate and lower 95% confidence bound are not below zero. Expansion recommendations are staged at 5%, 20%, 50%, and 100%. Reaching 100% requires `REPLICATED` evidence. Eligibility to make Reparodynamics the default requires at least 150 current replicated pairs while a major benefit remains supported. Every production promotion remains a separate target-bound owner-authorized action.

## Offline verification

The full no-spend evidence chain is part of `npm run verify`:

```sh
npm run proof:coding-benchmark
```

This exercises matched execution, per-arm persistence, pair completion, summary generation, promotion hold, snapshot persistence, proof binding, and read-only recovery loading without calling a model. Separate execution-guard tests use real local subprocesses to check concurrent admission and termination before receipt persistence. These tests make no provider requests.

## Explicit live LAB run

The live runner is manual, single-use and fail-closed. Run it only with a new exact-source owner grant. This code integration does not issue a grant or replay any historical one. A ten-case run has a maximum authorized cap of $3.00 because each of two arms may consume up to $0.15 per case. The actual accounted cost may be lower.

```sh
OPENAI_API_KEY='<credential>' \
SARA_CODING_BENCHMARK_AUTHORITY_SHA256='<exact-target-approval-digest>' \
SARA_CODING_BENCHMARK_SOURCE_REVISION='<immutable-git-revision>' \
npm run benchmark:coding:evidence:live -- \
  --acknowledge-lab-only \
  --benchmark-id '<uuid-v4>' \
  --max-spend-usd 3.00 \
  --current-canary-percent 5 \
  --case-count 10
```

`codingBenchmarkAuthorityDigest` in `src/coding-repair-benchmark-command.ts` deterministically generates the required approval digest. It binds the action, LAB-only scope, benchmark UUID, exact source revision, maximum spend, current canary stage, case count, and per-arm model limit. A digest copied from any other target is rejected.

The command also verifies that Git `HEAD` equals the bound revision and that tracked source files are clean. It refuses to start without the explicit live flag supplied by the package script, LAB-only acknowledgement, exact target digest, model credential, complete-pair budget, and valid case bounds. It stops before the next arm if the cap would be exceeded. Unknown spend is preserved as evidence and blocks further paid execution.

Do not interpret a successful ten-case run as a general multiplier. Its honest result is LAB evidence from an internally authored synthetic corpus, followed by a `hold` recommendation.

The older `benchmark:coding:live` entrypoint and its allocation fixture remain unchanged; they are not this evidence protocol and are not silently repurposed.
