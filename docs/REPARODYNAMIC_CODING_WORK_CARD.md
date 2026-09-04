# Reparodynamic coding work card

Status: bounded CANARY selector authorized for owner-authenticated Genome Lab program jobs. It may spend no more than $0.15 per repair run and may return only a deterministically verified SHADOW candidate. It receives no merge, deployment, promotion, or protected-file authority.

## Objective

Measure whether the same GPT-5.6 Luna worker produces more verified correct TypeScript work when surrounded by bounded Test → Detect → Localize → Repair → Verify → Rollback/Retain control.

## Experimental contract

- Language: TypeScript.
- Candidate boundary: existing Genome Lab only.
- Generator: GPT-5.6 Luna through SARA's bounded router.
- Maximum destination: a verified Genome Lab SHADOW candidate selected by the CANARY controller.
- Verification: source policy, compiler, immutable behavioral acceptance tests, artifact integrity, and existing kernel re-verification.
- Learning: evidence-bound lessons only; no raw prompts, responses, secrets, or customer-private code.
- Control: same Luna, starting artifact, context, budget, acceptance criteria, verifier, and environment with Reparodynamics off.

## Initial limits

| Control | Limit |
|---|---:|
| Repair cycles | 3 |
| Surgical files / changed lines | 2 / 80 |
| Deep files / changed lines | 6 / 240 |
| Model repair spend | $0.15 |
| Auto merge / deployment | Never / never |
| Protected paths or tests | Stop |
| Verification bypass | Never |

## Acceptance criteria for this foundation

1. Failures are structured and fingerprinted without unstable diagnostic prose.
2. The verifier, not Luna, determines improvement and completion.
3. Every proposal is bound to the current artifact, exact file digests, one observed failure, and immutable tests.
4. Regressions and no-progress proposals roll back to the best champion.
5. Cost, cycles, files, and changed lines fail closed at their limits.
6. SHADOW mode records the comparison but cannot replace the base generator output.
7. CANARY is wired into the owner-authenticated self-build route, returns only a deterministically verified proposal, and the existing kernel re-verifies it into SHADOW.
8. Offline proof spends no model budget; the live benchmark requires explicit invocation and separate spending authority.
9. Each live repair receipt is durably written before another cycle and a final run summary records the measured score change, time, cost, and artifact identities.

## Non-goals

No unrestricted repository coding, package installation, arbitrary shell/network access, production mutation, benchmark marketing claim, automatic NICO review, or cross-domain Reparodynamics is authorized in this slice.
