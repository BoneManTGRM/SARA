# Owner dashboard capability inventory correction

Baseline main: `88bb21caa280aabd326c6793319e3dbd6d2175d4`.

The owner dashboard read `state.capabilities.length`, which is the four legacy revenue-service capabilities. The digital worker registry has 93 separate contracts. Preserve the revenue state and its execution gates; connect the presentation to the existing authenticated `/api/capability-contracts` endpoint.

Acceptance: render the number of contracts that are enabled, qualified and currently passing qualification. Show registered inventory and legacy revenue-service counts separately. Never hardcode 93 or add the two different inventories together. Locked state must not request the inventory. Failed, malformed or duplicate inventory responses must clear the count rather than reuse stale data. Loss of authentication must lock the view. This presentation change grants no authority and changes no durable state.

Regression-first evidence: `node --import tsx --test tests/dashboard-capability-inventory.test.ts` reproduced the actual discrepancy, `4 !== 93`, using the served dashboard script, real kernel and authenticated HTTP routes. After the correction, the same case covers current inventory, reduced enabled inventory, quarantine/shadow/failed qualification, malformed/duplicate records, HTTP 503, empty inventory, recovery, relocking and HTTP 401.

Focused command: `node --import tsx --test tests/dashboard-capability-inventory.test.ts tests/dashboard-script.test.ts tests/owner-dashboard-theme.test.ts tests/owner-dashboard-mobile-layout.test.ts tests/digital-worker-http.test.ts` — 12 passed, zero failed. `npm run typecheck` passed. DOM elements are simulated in this regression test; HTTP and served script execution are real. Existing actual-browser and complete verification CI gates remain required before merge. Production acceptance requires the exact merged release, healthy persistent-state attestation and the existing registry runtime proofs; no authenticated production-browser screenshot is claimed.
