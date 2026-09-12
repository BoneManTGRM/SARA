# Engineering reliability capability wave

Baseline: main `05f6efae40d39827a97f9b46527fb6e3b98a1d52`, after the learned controls in PR170 and the shared contract/evidence path in PR171. This wave preserves the existing kernel, event store, policy, procedural memory, learning campaign, mandates and spending limits. It does not incorporate or supersede the separate service-opportunity-generator candidate PR172.

## Runtime interface and trust boundary

The existing authenticated capability-contract and invocation endpoints expose the implementations through `SaraKernel.invokeCapability`. Every invocation retains exact input/contract/implementation/result digests, observed/inferred/unknown distinctions, existing actor-bound receipts and zero-external-cash accounting. No new network, browser, database, repository mutation, customer communication, NICO approval, spending or deployment executor is added.

These capabilities are deterministic supplied-data analyzers and planners. They do not pretend to perform unrestricted language reasoning or inspect an external repository by themselves. Logs and freeform causal statements are represented by immutable digests instead of being copied into the durable audit. Configuration inputs accept safe metadata, not secret values. Statements about real conditions remain unverified unless supported by the appropriate actor-visible trusted evidence. Readiness is not transferable authority.

| Capability | Implemented behavior | Authority |
|---|---|---|
| ci-failure-triage | Earliest supported failed-step signature, competing hypotheses, conditional retry classification and next diagnostic | READ_ONLY |
| pull-request-risk-review | Bounded risk screening of supplied diffs and explicit required verification; not a complete security review | READ_ONLY |
| test-gap-mapper | Required behavior classes versus exact-revision supplied test mappings; stale and missing coverage remain visible | READ_ONLY |
| release-readiness-gate | All eight release categories, trusted exact-subject claims, blockers and artifact comparisons; never deploys | READ_ONLY |
| incident-log-triage | Strict explicit-timezone chronology, correlations, primary-failure hypotheses and cascade separation | READ_ONLY |
| repository-change-impact-analyzer | Reverse traversal of supplied dependency/caller graph; unknown paths and graph limitations retained | READ_ONLY |
| dependency-change-risk-triage | Direct/transitive and runtime/build/dev distinctions, exact major-version comparison and evidence-gated advisory claims | READ_ONLY |
| bug-reproduction-planner | Isolated reproduction steps and missing facts; production is redirected to an isolated copy | DRAFT_ONLY |
| root-cause-analyzer | Explicit symptom/trigger/defect/condition/cascade roles and competing/disconfirmed hypotheses | READ_ONLY |
| minimal-fix-selector | Acceptance and root-cause coverage before risk, affected paths and supplied cost; candidate selection is not repair proof | READ_ONLY |
| regression-surface-mapper | Behavior-level regression exposure through graph relationships, not filename proximity | READ_ONLY |
| configuration-drift-detector | Presence, fingerprint and version differences without configuration values | READ_ONLY |
| database-migration-risk-review | Destructive, irreversible, reader/writer, lock/backfill and unproven-recovery risks; never executes SQL | READ_ONLY |
| rollback-plan-generator | Exact-revision recovery prerequisites and plan, distinct from isolated rollback evidence | DRAFT_ONLY |
| production-proof-validator | Authentic production provenance, exact deployment and required behavior; deployment status and supplied claims are insufficient | READ_ONLY |
| stale-evidence-detector | Existing PR166 minimum-identity invalidation; unchanged unrelated evidence remains reusable | READ_ONLY |
| cross-repository-change-coordinator | Dependency-ordered exact-revision rollout and reverse rollback with cycle/compatibility checks; no repository changes | DRAFT_ONLY |

## Evidence and release semantics

Pure local analysis can report that a *supplied plan* meets its stated structural constraints without proving that real work is complete. `release-readiness-gate` and `production-proof-validator` are stricter: trusted proof references must match the required provenance, claim and subject. Supplied text cannot manufacture those records. The current public invocation route deliberately downgrades all externally supplied evidence to SUPPLIED; it does not provide an evidence-minting endpoint.

Built-in qualification executes frozen cases and reuses accepted results only at an unchanged implementation/case digest. Shared source files are read once during the loaded-code snapshot rather than once for every registered capability. Subsequent runtime identity checks still reread current bytes, preserving the fail-closed changed-loaded-source boundary. Nullable schema values express unknowns without admitting malformed non-null data.

## Acceptance and safe-runtime proof

The regression sequence established eighteen initial failures for missing registered behavior and nullable schema support, then separate failures for numeric-log retry confusion, impossible calendar dates, empty test criteria, unbounded risk output, missing runtime proof, and duplicated startup identity reads. Adversarial tests cover malformed inputs, forged production provenance, explicit blockers, stale deployment/UI identity, cycles, secret retention, concurrent replay, child-process restart and copied-state restore.

`sara_engineering_runtime_proof` exercises all seventeen implementations with harmless synthetic inputs through the real kernel. Its explicit checks compare outputs against contract expectations, inspect registration, confirm current receipts, retain the audit prefix and compare Constitution, stop, mandates, financial state, learning and memory before/after. Unchanged repeat proofs reuse receipts. The log binds the observed environment, deployed revision and deployment identity. It claims synthetic runtime computation and refusal behavior only, not successful customer work or external executor behavior.

A local full verification attempt that hits an environment execution limit is not a passing test suite. Full CI and CodeQL must pass on the exact reviewed PR head before integration. Required production proof must then be observed for the merged release. No other expansion wave is claimed complete by this document.
