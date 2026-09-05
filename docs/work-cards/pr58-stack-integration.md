# PR58 learning and compact-repair stack integration

The owner authorized completing and merging the existing SARA PR queue while pursuing dependable speed. This integration reuses PR58 rather than creating another implementation PR.

## Source and scope

Starting PR58: 45876bc64605ee76671444a7a39dfbcddda3a11b.
Reviewed current main: 9f88a9e27cd01aae0935f785e903735a4d23566d.
V7 stack tip: b451a41dc7add73613c0580a9b101ddd390a93a6.

The V7 tip contains the exact commits for PR62 (information learning), PR65 (stagnation guidance), PR73 (horizon guidance), PR86 (valid scaffolds and guarded edits), and PR88 (compact-first option). PR58 already contains the first three. Both ancestry merges apply without a conflict. No source is copied from the later Railway-specific PR90/PR93 experimental launchers, and no compiler cache is enabled here.

All existing application startup, server, kernel, persistent store, Constitution, primary safety policy, dependency lock, and Railway configuration remain byte-identical to the reviewed current main. Existing micro-batch fixes from PR85/PR95 are retained. Compact continuation and compact-first encoding remain explicitly opt-in. Learning guidance becomes part of the existing bounded repair path; it does not expand its three-cycle, file, changed-line or spending ceilings. The separate causal-novelty PR70 is not included or claimed resolved.

## Verification

An isolated local tree used the exact committed TypeScript 5.9.3 and tsx 4.23.13 dependencies recovered from read-only workflow 33958822217. The combined local log contains 329/329 passing repository tests, type checking, demo, bootstrap, self-build, revenue-pilot, coding and V3 proofs, 14/14 repeated HTTP checks, and the complete V6 parity record. The container call timed out before returning a process exit receipt, so that log is not advertised as a completed command gate. The exact-source integration workflow reruns the full command with exit-status capture, V7 mechanism proof and CodeQL before merge.

Review is direct code review by the integrating assistant, not independent human review. Tests establish bounded mechanism and compatibility, not population-wide coding accuracy or absence of all defects.

## Measurement and deployment boundaries

No provider calls, benchmark approvals, new credentials, runtime feature activation, pricing change or infrastructure mutation is part of this integration. Historical live and simulation records are not rewritten. The old allocation fixture's invalid structure is now rejected before model use; this is avoided waste, not a completed task or a measured speed improvement. Do not multiply separate historical gains.

A main merge may trigger the repository's existing deployment automation. This integration does not change that automation or assert that a successful merge proves deployed health. Production confirmation is separate. No source branches or evidence artifacts are deleted after integration.
