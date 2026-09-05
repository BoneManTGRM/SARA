# PR56: consolidate rollout evidence and preserve safe fallback

## Scope and acceptance

Integrate into main e804c316 without replacing the already-hardened PR57 matched evidence layer. Retain the historical PR56 commit e7446f7 by ancestry. Its competing receipt schema is superseded, not falsely labeled byte-identical. No automatic rollout or paid benchmark is enabled.

1. A completed, accounted, unsuccessful repair may return the original baseline proposal, once, with no second baseline generation or model call.
2. A failure before the model proposal boundary may return the baseline. Trusted model construction must be inert, as the current production factory is.
3. After any model invocation, thrown/unknown usage, malformed cost, or verification error remains fatal; fallback must not imply the paid request did not execute.
4. Durable receipt and final-run persistence errors remain fatal, including a pre-dispatch stopped receipt. Only optional fallback telemetry may fail without changing control flow.
5. The existing independent kernel must verify every returned proposal and refuse an invalid fallback. No mutation or promotion may be created from the invalid source.
6. Off/shadow behavior, base errors, maximum-cost reservation, protected controller/kernel/server/policy/Constitution and existing receipt/evidence tests remain intact.

## Superseded scope

PR57 owns matched methods, alternating order, durable receipts/snapshots, bootstrap intervals, complete-corpus checks, quality floors and recommendation evaluation. PR56's old competing coding-repair-benchmark/evidence schema must not overwrite those production APIs. Its broader catch-all error fallback is narrowed to protect unresolved spend and mandatory audit writes. Automatic exposure expansion remains prohibited; a recommendation is not authorization.

## Tests and evidence

Ten focused regressions first ran against unmodified main: six existing safety properties passed and four missing fallback behaviors failed. Local runner: Node22.16.0 with a disclosed global TypeScript5.8.3 transpilation loader, not the committed dependency toolchain. Pinned CI, full verification, archive identity and CodeQL remain mandatory before merge. No paid call or production operation is performed by these tests.

## Operational-review disposition

The old schema's named checks (digest binding, cost enforcement, protected paths, crash recovery, NICO assessment, owner approval and rollback drill) are retained as release-review requirements, not fabricated passing records. This consolidation does not enable its obsolete `eligible_default` endpoint or install a second promotion-statistics implementation. Default activation remains prohibited here, and current benchmark recommendations remain advisory until target-bound operator approval and independent release evidence exist. A passing fallback test is neither a completed NICO assessment nor a rollback drill.

Two additional safety controls verify that a failed stopped-receipt write before model dispatch and a verifier failure after dispatch remain fatal. The focused final local suite has twelve new tests plus the three original wrapper tests.
