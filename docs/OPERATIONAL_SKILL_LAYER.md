# Bounded operational-skill layer

SARA now has a zero-recurring-cost foundation for accumulating reusable procedural knowledge without treating repository text, papers, or prior experiment notes as trusted instructions.

The design is informed by the September 2, 2026 [Repo-To-Skill / DisCo paper](https://arxiv.org/abs/2609.02749) and its public [AREX-Skill implementation](https://github.com/VectorSpaceLab/AREX-Skill), but this repository contains an independent SARA implementation. It does not copy or bundle DisCo, its CLI, or the AREX skill collection.

## Candidate lifecycle

1. A bounded generator produces an ordinary dependency-free SARA skill candidate plus operational metadata.
2. Every source is classified as a repository, paper, or prior experiment and bound to an immutable revision, a non-zero content digest, attribution, an approved SPDX license, and immutable license evidence.
3. Source material has `instructionAuthority: false`. It cannot expand the work card or request credentials, network access, spending, deployment, customer contact, or production authority.
4. Genome Lab applies the existing syntax, static-authority, type, and behavioral checks. The complete artifact and verification result remain digest-bound.
5. A passing candidate stops at SHADOW. It is visible for owner review but cannot be loaded.
6. The existing target-bound owner promotion gate must advance the exact candidate to CANARY or later before the router may select it.
7. The router uses activation-term matches and returns no weak fallback when nothing fits. It returns context metadata only and grants no execution authority.

## License policy

The initial allowlist is deliberately conservative: `Apache-2.0`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `CC0-1.0`, `CC-BY-4.0`, and `LicenseRef-SARA-Proprietary`. Unknown, missing, moving, noncommercial, and copyleft inputs fail closed pending specific owner and legal review.

The AREX repository itself is Apache-2.0, while its README says each individual skill has its own authoritative license metadata. SARA therefore does not bulk-import AREX skills. An individual external skill can enter only through the same immutable provenance, license-clearance, isolated verification, and owner-promotion path.

## What this does not claim

- It does not reproduce the paper's reported benchmark results for SARA.
- It does not create a paid skill-construction service or a new model allowance.
- It does not autonomously promote skills or mutate production.
- It does not make external code safe merely because it has an open-source license.
- It does not let routed procedural knowledge override the Constitution, policy kernel, work card, evidence gates, or owner authority.

The public read-only bridge may inspect sanitized catalog state and safeguards. The owner endpoint may also request a bounded query route. Neither interface can execute a skill or promote a mutation.
