# Coding source preflight and the 35x target

A 3,400% throughput increase means 35 times the baseline throughput. This change does **not** establish that result for SARA's coding. The prior 35.47x correct-completion throughput was a simulation requiring 99.9% applicable repair reuse and 0.1-second checks, not measured production capability.

## Implemented change

The Genome Lab verifier now calls the same bounded TypeScript source guard before loading the semantic compiler graph or creating a candidate workspace. Disallowed source is rejected with an enumerated diagnosis and a source-only location. The builder independently repeats its guard; eligible code still receives fresh semantic checks, isolated behavioral execution and artifact hashing. There is no cached PASS or mutable compiler-AST reuse.

Protected-test diagnostics expose neither their path, location, literals nor rejection reason. Existing critical-capability signals remain critical. The verifier snapshots the admitted candidate across asynchronous work. The Luna adapter no longer labels a failed policy or integrity check as previously passing.

An early rejection's 0.2 score means only the artifact-integrity stage passed. It is not a percentage of correct acceptance tests. Type checking and behavior are not recorded as performed on this path.

## Executed offline evidence

Node v22.16.0 and locked TypeScript 5.9.3 were used. The control implementation was main revision `4c722994a623fde631f93cce4de02be2c1f65096`.

The six original proposals from consumed grant `33d94c9a-0de6-41d9-a843-fe9880994242` were checked unchanged in three rounds, alternating old/new verification order. All 18 pairs rejected the same proposals and retained identical candidate artifact identities. Total rejection-verification time was 6,804.600 ms before versus 13.899 ms after (489.56x for this **rejection component only**). Every sample, including cold loading, was retained. These are post-run diagnostics, not new coding attempts or new successful tasks.

Six further old/new pairs used the existing known-correct verifier fixture and the unchanged broken task. All outcomes matched: the correct fixture passed; the broken task failed; both underwent semantic and behavioral checks. The three positive-control verifications totaled 2,895.574 ms versus 2,385.799 ms. This small, cold-start-sensitive sample is a correctness control, not evidence of a dependable 1.21x coding gain.

Focused tests cover premature compiler creation, syntax and policy classifications, protected-test secrecy, wrong types, wrong behavior, critical capabilities, mutation across awaits and model-facing feedback. The complete repository verification remains mandatory before merge.

## What is unchanged

The task, hidden acceptance files, model, sampling settings, cycle limits, spending grants, original receipts, and historical unresolved $0.15 hold are unchanged. No provider request was made. The repair-memory implementation remains a proof prototype; this patch does not claim it is deployed or able to reuse 99.9% of actual jobs.

## Remaining proof for 35x

A separately authorized matched live comparison must measure successful completions per total elapsed time, including new generation, failed attempts, verification, learning and memory misses. It must separately report novel work and exact-repeat work, and compare against an ordinary system with equivalent standard optimizations. A faster rejected proposal does not satisfy this requirement. A source merge also does not establish that Railway is running that revision.

Run the local regression suite with `npm run verify`. The source preflight and feedback subset is:

```sh
node --import tsx --test tests/coding-source-preflight.test.ts tests/coding-repair-bounded-language-feedback.test.ts tests/luna-coding-repair-model.test.ts
```
