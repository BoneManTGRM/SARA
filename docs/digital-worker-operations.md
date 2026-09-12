# Digital worker operations

The digital worker uses SARA's existing authenticated owner interface, append-only audit, durable jobs, standing mandates, budget ledger and PR166 procedural store. Capability availability is not permission to act externally.

## Owner API

All routes below require the existing owner bearer credential. A read-only bridge credential, customer text or `ownerAuthenticated` field cannot authorize these routes. Keep credentials in the existing client authentication mechanism, outside request bodies, evidence and reports.

| Method and path | Purpose |
|---|---|
| `GET /api/capability-contracts` | Current exact contracts, schemas, maturity, enablement, authority and frozen qualification |
| `POST /api/capabilities/invoke` | Execute one bounded implementation and retain its audit receipt |
| `POST /api/capabilities/evidence/owner-observed` | Capture a source-bound owner observation; provenance stays OWNER_OBSERVED |
| `POST /api/capabilities/plans/run` | Execute an explicit dependency plan against exact contract digests |
| `POST /api/capabilities/goals/run` | Compile a supported goal into the existing plan executor using supplied step inputs |

Read the current input/output schema before constructing an invocation. Reuse the same actor and request ID for an identical retry. A conflicting request ID is rejected. Reference earlier results with `evidenceReceiptIds`; the kernel checks receipt integrity, actor visibility and relevant dependencies. An old receipt remains historical evidence when its subject changes, but cannot prove the new state.

## Harmless example

The invocation body below analyzes supplied logs. It does not rerun CI or change a repository. Replace the synthetic revision with the actual subject when analyzing real work.

```json
{
  "requestId": "supplied-ci-install-triage-1",
  "capabilityId": "ci-failure-triage",
  "input": {
    "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "changedFiles": ["package-lock.json"],
    "steps": [
      {
        "id": "install",
        "status": "FAILED",
        "logs": "ERESOLVE unable to resolve dependency tree\nProcess completed with exit code 1"
      }
    ]
  }
}
```

Inspect the receipt's observations, inferences, unknowns, authority, costs, subject and result digest. `SUCCEEDED` means the capability executed its contract; an output of `INCOMPLETE_EVIDENCE`, `BLOCKED` or failed acceptance still blocks the represented work. Plan completion additionally requires its explicit output predicates.

## Execution and economic boundaries

Goal templates cover bounded software analysis, business preparation, secretary work and NICO readiness. Missing step inputs remain explicit blockers. Plans execute current read/draft contracts; implementation and external deployment remain in the existing authorized software/job executors. Completed steps, reservations and receipts survive restart and copied-state restoration.

Current job-bound economic receipts inform existing revenue and learning queues beneath authority, obligations, active-work recovery, prerequisites and operating ceilings. Supplied forecasts remain forecasts. Profitability can read durable revenue/job/model records, including failed work; unidentified allocations remain unknown and prevent an unsupported full-profitability claim. No economic score authorizes spending or abandons a hard obligation.

Procedure compilation and reuse use the existing PR166 store. Failed exact procedure versions lose reuse eligibility; supersession preserves history. Learned capability quarantine/disable/restoration continues through the existing owner control mechanism, retaining original qualification and promotion evidence. Fresh qualification and exact trusted owner authority are required to restore restricted learned capabilities.

## Integration scope

Secretary outputs, customer proposals, calendar candidates and agent contracts are drafts. External-agent communication remains unavailable without the existing allowlist and authority. NICO analysis preserves exact source, scanners, independent QC, approval and protected delivery requirements; the configured observer performs only a bounded authorized read and never manufactures production identity or approval.

Web analysis accepts source-bound snapshots. Optional supplied HTML runs in a fresh sandboxed browser with scripts and network blocked, no inherited credentials and no submission route. A missing browser returns incomplete evidence. The required CI browser proof uses actual Chrome; it does not claim general live-site production browsing. Financial, contractual, security and publication boundaries still require exact existing authority.

## Qualification and evidence

`docs/digital-worker-mission-inventory.json` enumerates the 93 required IDs independently of the registry. CI requires `node --import tsx src/digital-capabilities/web/browser-qualification.ts` and `npm run verify`, including control, persistence, recovery, adversarial, economic and HTTP tests. The browser prerequisite runs first so environment failures surface before the long suite. CodeQL is separate.

Startup emits release/state attestation and bounded runtime proofs against the exact serving revision. These exercise harmless synthetic analysis and denial paths, preserve the audit prefix and compare protected state before and after. They do not prove customer outcomes or fabricate NICO production behavior. Use actual source-bound acceptance evidence for each real job; deployment success alone never establishes completion.
