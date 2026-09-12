# Service opportunity generator

Status: SHADOW candidate · owner review required · no offer, outreach, payment, customer work, or deployment authorized

## Opportunity and public evidence

SARA can now qualify and execute bounded capabilities, but the new substrate has no evidence-gated way to turn those capabilities into candidate services. The U.S. Small Business Administration says market research should examine demand, market size, saturation, and what customers pay for alternatives; it also warns that existing sources may not be specific enough for a target audience. GitHub separately documents that a repository README commonly tells visitors what a project does, why it is useful, how to get started, and where to get help. These sources support the need for evidence-based service discovery and the existing documentation-review category. They do not prove demand for SARA, willingness to pay, or any price.

- <https://www.sba.gov/business-guide/plan-your-business/market-research-competitive-analysis>
- <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes>

## Candidate

Add one reviewed built-in `service-opportunity-generator` to the common authority-bound capability substrate. It consumes only supplied JSON:

- current capability IDs, contract digests, qualification/status evidence, and bounded delivery estimates;
- public demand observations with source URL, observation date, customer problem, required capabilities, and any observed comparable price;
- maximum delivery time, maximum cash cost, and maximum candidate count.

It groups identical service concepts deterministically, deduplicates exact observations, counts distinct source hosts without claiming publisher independence, and produces an owner-review, evidence-required, or rejected card. An owner-review card requires two distinct public source hosts, two host-diverse comparable-price observations, every required capability qualified and enabled, and estimates within the supplied ceilings.

The output reports observed price range only. `recommendedPriceUsd` is always `null`, and every result explicitly denies customer contact, publication, contract acceptance, spending, and work execution. Public observations remain `UNVALIDATED_PUBLIC_SIGNALS`; the compiler performs no network access and cannot claim that the URLs or prices are true.

## Falsifiable acceptance criteria

1. Two source-host-diverse supplied observations plus kernel-confirmed current qualified capabilities and demonstrated matching procedures produce one deterministic `OWNER_REVIEW` candidate.
2. A single source host, missing/disabled capability, or missing price evidence remains `EVIDENCE_REQUIRED`.
3. Delivery time or cash cost beyond the supplied ceiling produces `REJECTED`.
4. Reordered inputs and exact duplicate observations produce byte-equivalent canonical output without mutating input.
5. HTTP, credential-bearing, local, IP-literal, and malformed evidence URLs fail closed.
6. The capability runs through SARA's existing internal principal and common receipt boundary with zero cash cost and no job, payment-intent, revenue, or external-authority change.

## Revenue hypothesis

This capability can reduce speculative service building by requiring public problem, price, capability, and cost evidence before an idea reaches owner review. If it produces no candidate that survives manual source verification, or if source review takes longer than the avoided speculative work, it should be simplified or retired. It does not establish that any proposed service will sell.


## Continuation: trusted capability and procedure evidence

Reconciled main is `dbf9d45d77785d4de1ef4956fe8bec123a59a5ce` after engineering PR173. The original candidate trusted caller-supplied qualification labels. A regression demonstrated that an invented capability produced OWNER_REVIEW. The updated compiler defaults to EVIDENCE_REQUIRED unless the kernel supplies current registered qualification and exact contract identity plus demonstrated independently qualified procedure evidence from the existing PR166 store.

The read-only projection neither initializes procedural state nor adds seeds. The latest matching procedure outcome must be VERIFIED, with fresh verification evidence; invalidated, superseded, stale, absent, or failed procedures do not supply service readiness. Contract and procedure evidence digests are retained. A changed prerequisite makes an old idempotent receipt explicitly historical instead of rewriting it. No model call or external lookup is added.

Focused qualification covers forged labels, actual contracts without procedures, a demonstrated procedure through the existing execution engine, stale contract refusal, restart/copied-state restore, later failed verification, unchanged replay, malformed inputs and corrupt procedural state. `sara_service_runtime_proof` exercises an unsupported synthetic service through the production kernel; it does not claim real customer demand or successful paid delivery.

The built-in compiler is qualified read-only/draft logic after its gates pass. Generated service ideas remain candidates and do not grant commercial authority. This repairs one business capability; it does not complete the remaining expansion waves.
