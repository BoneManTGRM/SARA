# V6: bounded coding-efficiency experiment

Base: `9aa786c4eaea43df0a8a3f62ee3efea57bd5da0f` on
`experiment/reparodynamic-learning-v5-horizon-aware`. This branch is experimental,
not a production promotion. The full V5 controller, authority, and independent
Genome Lab verifier remain the comparison basis.

## Implemented interventions

1. Reuse Genome Lab's existing structural validator before expensive verification.
   An invalid candidate structure is an explicit policy stop, not a behavioral
   failure scored 0.8. The controller and matched benchmark reject this condition
   before any model call. The benchmark's two-file allocation scaffold cannot
   satisfy the three-file/index-module requirement through existing-file repairs.
2. Optional `compactRepairContinuations: true` on `createLunaCodingRepairModel`.
   The first proposal is unchanged. Later model replies can contain bounded,
   digest-bound literal find/replace edits instead of complete file contents.
   Local expansion yields the same canonical full-replacement proposal, which
   passes through the original validation, line ceilings, controller, and verifier.
   The feature defaults off and does not change any production configuration.
3. Preserve known provider usage in a sanitized `CodingRepairOutputError` when
   parsing or validating a returned proposal fails. This is not a claim that all
   pre-existing transport-failure accounting or persistence is now resolved.

## Safety contract

All existing ceilings remain: three cycles, two surgical files/80 lines, six deep
files/240 lines, $0.15 logical per arm, $0.15 physical matched-trace maximum.
Protected paths cannot be removed. Strategy belongs to the controller. Edits
must have unique literal anchors in the original source, apply simultaneously,
not overlap, and retain the 16 KiB resulting file ceiling. No fuzzy application,
new files, test modification, model-selected strategy, or extra retry is allowed.
Malformed, stale, duplicate, ambiguous, no-op, and oversized edits fail closed.
No dependency, customer price, credential, deployment, or production state is changed.

## Reproduction and evidence classes

Run `npm ci`, `npm test`, `npm run typecheck`, and
`npm run proof:reparodynamic-efficiency-v6` on the pinned candidate. `npm run verify`
includes the new proof. CI also repeats the HTTP proof and analyzes the exact
head with CodeQL.

The proof tests three valid executable fixtures with an independent known-good
reference checked before use: bounded count, integer delta milliseconds, and
canonical tags. Scripted external-client replies drive the actual adapter and
controller. Both transports must reconstruct identical proposal and artifact
digests and independently pass Genome Lab. The scripted model does not change its
answer in response to learning prompts. This proves transport equivalence, not
that Luna will generate the same answer or be faster.

Four additional single-line compile-probe repairs measure JSON wire bytes on real
source files. These are serialization-only cases, not executable Genome Lab tasks.
Byte savings are not token, provider cost, reasoning-time, or total coding-time
savings. Extra prompt/schema overhead and malformed-edit rates can offset savings.
All these experiments make zero provider calls. General performance claims remain false.

Recorded local RED/GREEN cycles cover missing scaffold rejection and edit expansion,
unsafe loss of usage on malformed output, direct ceiling expansion, and the matched
baseline guard. Separate immutable logs and hashes accompany the evidence export.
Additional defensive tests were added after implementation; they are not mislabeled
as individually observed RED cycles.

## Next paid comparison: preregister before execution

Do not run the existing simplified standalone VM harness as proof of V5 performance.
Use the actual frozen controller. Require a valid scaffold and independently verified
reference before a paid request. Compare full replacement with compact continuation
transport, holding the initial proposal, model route, reasoning, objective, memory,
environment, verifier, authority, and cost ceilings constant. Record first-call ties
rather than searching until a favorable case appears. No paid corpus is authorized
by this document.

Include all attempted calls and known charges, retain unknown failed-call cost as
unknown, and measure end-to-end time through final independent verification. Compare
raw time and cost only when both arms independently complete. Report per-case
completion, rejects, tokens, actual cost, wall time, and exact artifact/receipt digests.
A case advances only with preserved completion, no higher measured cost, intact
safety, and a measurable time improvement. One trace never supports a general claim.
A 200% speed increase means 3x verified throughput, not a 200% reduction in time.
