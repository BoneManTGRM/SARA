# Complete the remaining saved post-merge correction

## Current-main reconciliation

This corrective change starts from main `9c8d68a2ac0333139a57b7b5c67bc84f905429ca`
(tree `0c7e579b83cf8ce5883286f0560b311b4a979953`), after PR100.
The older saved patch targeted `195b2e3`; it must not replace PR100 wholesale.
PR100 already removes mutable compiler AST reuse and corrects strict verifier,
proposal, accounting, grant and arithmetic boundaries. Those implementations,
including their additional regressions and known-cost retention, remain intact.

The saved correction's 21 regression cases were run unchanged against current
main. Sixteen passed; five failed, all in repair-memory quarantine/identity
retention. This change ports only that remaining implementation and adds the
complete saved regression file alongside, not instead of, PR100's tests.

## Remaining reproduced failures

1. Quarantining repair A, replacing it with B, then relearning A reactivated A.
2. Changing only the evidence digest gave the same quarantined repair a new ID.
3. Quarantining an old ID after replacement did not affect later relearning.
4. Capacity counted active source keys but did not retain revoked identities.
5. Reordering files or refreshing evidence changed the same repair's identity.

## Correction

A repair identity now binds the original source, complete four-part scope,
canonically ordered changes and verified result source. Evidence labels are
retained as evidence but do not define repair identity. A separate bounded record
map retains superseded and quarantined identities; an active map selects the
current repair for each source/scope. Quarantine survives replacement, evidence
refresh, file-order changes and relearning. A genuinely different verified repair
can still be used. No automatic fallback to another recipe is introduced.

The 32-identity ceiling counts all retained identities, not just active keys.
At capacity new identities are rejected before modifying memory. Existing IDs
may be relearned without clearing quarantine. Unknown quarantine IDs are rejected
rather than silently reporting success. Lookup continues to require strictly
validated failed verification bound to the original candidate, and every selected
recipe still requires fresh controller verification. Policy limits are privately
snapshotted; returned recipes/snapshots cannot mutate retained records.

This is still an in-memory proof mechanism. Records do not survive a new instance
or process. It is not activated in production or the frozen matched benchmark;
there is no claim of durable cross-job learning or a measured speed benefit.

## Verification boundary

The unchanged 21-case saved regression file is in
`tests/postmerge-repair-safety.test.ts`. Its real compiler poisoning test and
independently reverified sandboxed V5 positive control are retained. No paid model
is invoked. Before merge require full final-source CI, CodeQL and integrated
source review; earlier green checks are not substitutes. Repeated subsets are
not additional unique tests. Test failures, incomplete commands and infrastructure
errors must remain in the evidence record.

Only this document, `proof/guarded-repair-memory.ts` and the new regression file
are changed. Existing tests, workflows, dependencies, production controller,
owner/kernel/stop controls, frozen task/hidden tests and startup remain unchanged.
No deployment, activation, paid dispatch, historical replay or new infrastructure
is part of this source correction. The original unresolved $0.15 authorization
remains held; source repair cannot manufacture missing execution/usage records.
PR69 and all NICO/Gmail work remain excluded.
