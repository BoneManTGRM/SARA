# Wave 3: procedural capability interfaces

Extend PR166 ProceduralKnowledgeStore and memory-fabric identity checks. Do not create another memory store. Compile only actual independently verified successful stored histories into CANDIDATE playbooks; never promote through compilation. Rank applicable verified procedures using current identities and fresh history, retain failed and superseded evidence. Quantify actual stored success/failure and operations avoided, leaving unavailable cost/time/regression data unknown. Detect conflicting claims, expire only time-sensitive knowledge, retrieve relevant negative lessons, seek disconfirming trusted evidence, and calibrate supplied forecasts against observed stored outcomes without inventing calibration samples.

Owner mutation paths require authenticated owner, current allowed policy and emergency-stop clear. They use existing atomic store methods; preserved candidates and supersession survive reboot/copy. Public JSON cannot supply a trusted knowledge snapshot. Strict schemas, deterministic analysis and frozen/adversarial tests qualify all eight definitions. Kernel integration must attach a trusted snapshot and bind its digest to receipt invalidation.

## Acceptance evidence

- RED `node --import tsx --test tests/procedural-capabilities.test.ts`: missing implementation module, exit 1.
- Additional RED against existing PR166 public store: actual `freshVerify` failure still allowed subsequent `store.select`, producing `Missing expected exception`. Small repair filters every exact playbook version with any recorded FAILED execution at both selection and pre-execution refresh. A later appended success cannot restore that version. An independently qualified new version can be selected; original status, qualification and outcomes remain unchanged.
- GREEN `node --import tsx --test tests/procedural-capabilities.test.ts tests/procedural-intelligence-engine.test.ts tests/procedural-intelligence-lifecycle.test.ts tests/service-opportunity-trust.test.ts`: exit 0, 39 passed / 0 failed (13 new capability tests plus existing affected regressions).
- Frozen contracts cover all eight implementations; strict closed inputs reject injected snapshots and fabricated forecast proof. Positive fixtures use the actual existing ProceduralKnowledgeStore, its independent qualification lifecycle and executeVerifiedProcedure.
- Actual filesystem restart/copy tests prove candidate and supersession persistence, replay after simulated process interruption between store commit and kernel receipt, exact state/digest denial, no duplicate candidates under concurrency, failed/pending-state protection and committed-state integrity rejection. This does not claim real production mutation testing.
- A qualified new replacement supersedes the exact reviewed prior playbook with original qualification/evidence/outcomes retained; repeat application after restart or backup remains idempotent. No automatic enabling/restoration occurs.
- Minimum relevant dependency digests preserve successful analysis after unrelated family changes; failed relevant outcomes invalidate ranking. Full snapshot is bound only for explicit candidate/supersession concurrency checks.
- Overall typecheck is delegated to parent after concurrent wave construction; Wave 3 files are clean. Parent runs final integrated `npm run verify`, exact-head CI, registration, audit and safe-runtime qualification.

## Runtime seam

`proceduralDefinitions` exports the eight definitions. `executeProceduralCapability(id,input,context,stateDirectory)` reads the existing store and applies only exact owner-authorized candidate/supersession requests. Parent must first enforce its existing `record_memory` action, persist the kernel audit receipt and bind `proceduralDependencyDigest` for fresh/replayed results. Other read-only calls receive `context.proceduralKnowledge` from `inspectExisting`; public JSON cannot provide it. There is no migration or second store.

`procedure-effectiveness-scorer` measures real stored success/failure and operations avoided. Existing PR166 outcomes lack actual elapsed time/cash/retry/intervention/regression measurements; these fields remain explicitly unknown rather than fabricated. Confidence calibration requires matching trusted forecast evidence captured before the recorded outcome, plus actual task-specific stored results.

## Final measured-effectiveness extension

The scorer additionally accepts optional BASELINE/REUSE measurements backed by existing trusted evidence receipts. Each receipt must match the complete measurement digest, actual stored task outcome identity, procedure identity, comparison ID/basis, and the `procedure-performance-measurement` claim. Values remain unknown if proof is absent, supplied-only, stale, mismatched or malformed. Output counts actual metric coverage; time is a measured mean, cash/retry/intervention are measured totals, and regression rate uses observed regression opportunities. Savings are computed only across paired measurements with identical task/comparison/basis. No new telemetry store is created.

Final affected verification: `node --import tsx --test tests/procedural-capabilities.test.ts tests/procedural-intelligence-engine.test.ts tests/procedural-intelligence-lifecycle.test.ts tests/service-opportunity-trust.test.ts` — exit 0, **40 passed / 0 failed**. `npm run typecheck` — exit 0. Long-history output references are bounded with explicit truncation flags; underlying historical records remain intact.
