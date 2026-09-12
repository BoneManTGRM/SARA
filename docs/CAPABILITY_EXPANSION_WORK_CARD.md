# General-purpose digital worker expansion

Authoritative source baseline: `81e074afd797e5ba698d6bac302b70c600d31a00` (tree `7ba4849c51a32121f5b777a4026b310bd383d4f9`). The baseline includes PRs 166–169. PR 169's useful-job projection and bounded learning-root policy remain authoritative.

## Wave 0: learned capability control

Extend the kernel-private append-only event store; do not replace mutation promotion stages, audit history, learning campaigns, mandates, or procedural intelligence. Operational state is independent of historical promotion stage. Quarantine/disable removes execution and routing eligibility while retaining artifacts and evidence. Restoration requires a genuinely authenticated owner, exact target-bound approval, and fresh independent qualification after the last restriction. A stale approval cannot restore a later restriction. Replayed identical requests do not duplicate changes. An in-flight result is withheld when control state changes.

Automatic quarantine uses objective kernel verification/integrity failures only. Ordinary malformed input and unsupported model/customer opinions cannot revoke capabilities. The existing forward-only promotion API cannot bypass quarantine. Legacy execution-failure restrictions remain conservative until owner-reviewed restoration.

### Observable acceptance

- Owner can review and apply exact quarantine/disable/restoration requests over the existing authenticated HTTP API.
- Disabled/quarantined code is absent from normal available-capability and operational-skill routing.
- Original stage, qualification, evidence, and control history remain visible.
- A real child-process restart and copied-state restore retain restrictions and audit-chain validity.
- Automatic regression quarantine is independent of untrusted task input.
- No new spending, outbound communication, credentials, NICO approval, or external authority.

### Verification

`node --import tsx --test tests/learned-capability-control.test.ts`

Then affected learning, operational-skill, state-fingerprint, backup/restore, HTTP tests, and `npm run verify` on the frozen candidate. CI and CodeQL must pass on the exact PR head before merge. Deployment status is not runtime proof.

## Subsequent waves

Extend common contracts/evidence and the existing policy authority before adding engineering reliability, troubleshooting, procedural intelligence, economics/business, secretary, NICO, browser, agent collaboration, and scheduler behavior. Each capability needs actual implementation, explicit qualifications, and an honest maturity row; registration alone is not completion. Keep unknown evidence unknown. Preserve existing owner operating limits and the frozen learning curriculum.


## Wave 0b: common contract and evidence path

Base is the PR170 source tree `18f587d04a7783f5f1f0d82a9601a42eb5ba1648`, merged as `d2b70329bbcae131fd702eaa227e16e1122f8728`. Extend only reviewed built-in modules; no external manifest, customer input, or learned artifact can register itself. Keep immutable source/input/result digests, strict bounded JSON contracts, observed/inferred/unknown separation, supplied provenance that cannot impersonate production, and actor-bound durable receipts in the existing audit store. A receipt is historical evidence, never a transferable authorization. Read/draft analysis must not call external services, spend, or alter control state. Qualification executes fixed predicates and reports failures; it never restores learned code.

RED: eight kernel acceptance tests failed before implementation (`wave0b-substrate-red.log`). Required GREEN includes all eight plus adversarial provenance, malformed schema, concurrent replay, HTTP authentication, and restart/restore coverage. Existing evidence applicability from PR166 is reused for minimum-identity invalidation. No persistent-state migration or additional runtime dependency.

Wave 0b focused verification: 22 tests passed, zero failed (strict JSON, supplied-evidence downgrade, receipt integrity, exact-input replay, concurrent requests, real child restart, copied-state restore, real HTTP denial, emergency stop, anti-churn cache, and harmless runtime proof). Twenty affected control/procedure/persistence tests also passed. TypeScript passed. Runtime proof deliberately claims only local computation and denied routes on the exact deployment; a production learned-control mutation is not exercised against owner state. Unpersisted invalid input explicitly reports no persistent changes. Qualification evidence is cached by exact implementation and frozen-case digests; changed loaded source fails closed until process restart.

Three static implementations are registered in this wave: autonomy-boundary-checker, learned-capability-disable-and-quarantine (inspection plus existing exact-owner mutation API), and self-benchmark-runner. They do not represent implementation of the remaining requested capability inventory. The boundary checker is analysis-only; existing effect-specific executors retain their exact authority checks. Extending the common gate through those executors remains required before broader effectful execution.
