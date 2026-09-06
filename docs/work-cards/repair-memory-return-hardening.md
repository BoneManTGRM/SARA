# Learned-repair return hardening and idempotent storage

## Scope

Owner-requested hardening of the existing SARA canary learned-repair path, based
on release `d29d0bacaa423cd998d420e34826390ba313e077` (PR #122). This change does
not grant the model production promotion, merge, deployment, or spending rights.
No new benchmark or provider request is authorized by this work card.

## Reproduced defects and acceptance

1. A new recipe could be revoked, its store disabled, or its record removed while
   the required final reuse receipt awaited I/O. Existing final-return checks
   covered recalled recipes but not the just-learned one. After all required
   callbacks, validate the new recipe's exact key, ID, and verified artifact
   against the current locked store before returning or releasing followers as
   committed. A failed check is fatal and follows existing durable quarantine
   handling. This does not claim an atomic cross-process revocation guarantee
   after the final check or after return; independent kernel checking remains.
2. Relearning an identical committed recipe, or quarantining an already
   quarantined recipe, unnecessarily replaced the whole memory file. A private
   transaction now reports whether state actually changed. No-op acknowledgments
   still acquire the same lock, reread/validate current bytes and boundaries, and
   release the lock durably. They skip only the unchanged file replacement.
   New recipes and first quarantines retain the existing write/fsync/rename/
   directory-fsync sequence and ambiguous-failure lock preservation.

## Required evidence

- Reproduce final-receipt revocation/disable/deletion and the waiting-leader
  case against the previous release before applying fixes.
- Pin file handles while comparing inodes, not mtimes, to prove no-op operations
  did not replace files. Changed writes must still replace the file and survive
  a fresh store instance. Corruption and insecure permissions must still reject.
- Retain the first quarantine reason, immutable identities, capacity bounds,
  private filesystem checks, source/test/owner scopes, and existing locks.
- Preserve cold/warm model-call reduction and all fresh verification calls.
- Full `npm run verify`, exact-head CI and CodeQL before release; source-only
  deployment to the existing operator, with no changes to credentials, budgets,
  constitution, volumes, replicas, grants, or NICO.

## Measurement boundary

Storage timing is a component measurement, not a coding-speed multiplier.
Any scripted end-to-end comparison excludes real inference and must be labeled
as such. The historic 20.89x individual repeat and 16.26x pooled warm result are
unchanged prior observations; they are neither requalified nor increased by this
hardening. No cached PASS, AST, compiler result, or acceptance-test bypass is added.
The existing implementation-scoped memory key changes with these source bytes;
old recipes remain in their old scopes and are not silently migrated or deleted.
