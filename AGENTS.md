# SARA development contract

SARA is an owner-controlled self-development kernel. Read this file, `constitution/constitution.v1.json`, and the active work card before changing code.

## Bootstrap boundary

- Bootstrap target: **$0 in new monthly recurring cost**.
- The protected $300/month value is a ceiling, never a target or pre-authorization.
- Do not provision paid hosting, databases, queues, monitoring, model APIs, agents, or SaaS.
- Do not expand the long-term roadmap unless a bounded work card requires it.
- `saraseed.app` is deployment configuration. SARA's identity and Constitution must not depend on one domain or provider.

## Authority

- Never change owner identity, ownership, distributions, payment destinations, banking, authentication authority, protected secrets, spending ceilings, the Constitution, or immutable audit history without direct owner action.
- New code begins as a Genome Lab candidate. It may not self-overwrite production.
- Production promotion starts at CANARY and requires target-bound authenticated owner approval.
- Emergency stop must preserve owner access, reads, memory, audit, and recovery while freezing new external actions, spending, protected changes, child execution, and mutations.

## Work method

1. Trace the work to a falsifiable work-card acceptance criterion.
2. Make the smallest coherent candidate change.
3. Run focused tests, then `npm run verify`.
4. Record exact command, exit code, decisive output, and candidate digest.
5. Treat passing local checks as evidence, not owner approval.
6. Submit changes through a reviewable branch/PR when external GitHub authority is available; never bypass branch protection or self-approve.

## Commands

- `npm test` — constitutional, economic, memory, mutation, and TGRM tests.
- `npm run proof:bootstrap` — end-to-end self-development tracer.
- `npm run proof:http` — owner dashboard/auth/emergency-stop boundary.
- `npm run typecheck` — strict TypeScript check.
- `npm run verify` — full integrated local gate.

## Current architecture

- `constitution/constitution.v1.json` — canonical protected rules.
- `src/store.ts` — read-only event types; the write-capable hash-chained store is kernel-private.
- `src/kernel.ts` — memory, ledger, capability, job, and mutation lifecycle.
- `src/policy.ts` — machine-enforced authority and economic gates.
- `src/server.ts` / `src/dashboard.ts` — one minimal backend and owner dashboard.
- `src/genome-lab.ts` — deterministic $0 coding child and compiler-checked candidate artifacts.
- `tgrm/` — existing Test → Detect → Repair → Verify engine.

Do not add a second backend, website, dashboard, ledger, memory authority, or policy authority.
