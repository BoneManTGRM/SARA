# Wave 6: NICO operational intelligence

Extend the existing NicoOperatorClient read-only terminal-manifest projection and existing automated-package verifier. Inspection confirms SARA's NICO adapter binds app.nicoaudit.com, explicit run IDs, HTTPS, redirects denied and bounded requests. NICO has separate human-reviewed protected delivery and explicitly authorized automated technical package paths. Automated packages must disclose no human review and no security certification; this work does not impose invented specialist approvals on that existing mode.

Implement ten evidence-bound capabilities: run health, scanner inventory/completeness, specialist queue, review readiness, export integrity, bilingual discrepancies, exact approval provenance, protected delivery readiness, actual read-only production proof, and safe client status. Supplied flags never prove scanner execution, non-applicability, approval, QC, delivery or production. All identities bind run/repository/commit/report revision/digest. Independent actor requirements reject SARA/self-verification. No capability sends a message, invokes a NICO approval route, purchases, or delivers a protected artifact.

Production reader uses the existing client's getRun only; explicit release identity must come from that same observed envelope. Missing release identity remains incomplete, never guessed from supplied SHA or repository state. Local HTTP fixtures prove integration; CI/isolated evidence cannot become production.

RED first: missing nico definitions module. Parent owns registry/kernel/boot integration and final CI/runtime proof. No NICO repository changes.

## Verified implementation

- `nicoDefinitions` exports ten executable contracts using shared strict schemas, evidence envelopes and source digests.
- Scanner completeness requires an exact evidence-backed inventory digest and each execution or documented inapplicability record. Unknown applicability does not pass.
- Human review uses distinct producer, specialist and QC identities tied to exact report revision; SARA/self actors are rejected. Automated technical authorization remains separate, explicitly not human-reviewed and not a security certification.
- Export verification hashes actual bytes, compares exact canonical evidence, and calls existing `verifyProductionNicoPackage` for automated ZIPs. It never fetches a consequential package endpoint or authorizes delivery.
- Bilingual screening detects numeric/identifier, severity and negation differences; an unflagged pair is not semantic proof. Exact independent semantic-review evidence is required to report verified equivalence.
- Delivery readiness requires immutable source, scanner evidence, workflow-specific approval, artifact/bilingual integrity, protected access and separately existing delivery authority. Output never grants authority or delivers.
- `createNicoReadObserver` wraps only the existing `getRun`. Release identity is a pure projection of that same response's explicit `nico.comprehensive_release_provenance.v1` native identity, with established/no-conflict flags. Missing deployment identity is incomplete. Captured evidence has only observed run/report identity claims; never invented scanners, QC, approval or delivery. Production, isolated and external-read-only grades remain distinct.
- Source response content is bounded and hashed; no raw page instructions, customer fields, passwords or credentials enter output. NICO requests use the existing fixed HTTPS adapter, redirects denied. Isolated source URLs are restricted to loopback and cannot be configured in production mode.

## Qualification

RED: `node --import tsx --test tests/nico-capabilities.test.ts` — exit 1, missing definitions module before implementation.

GREEN: `node --import tsx --test tests/nico-capabilities.test.ts tests/nico-operator.test.ts tests/nico-automated-package-verifier.test.ts tests/nico-http.test.ts` — exit 0, **28 passed / 0 failed**. Includes all ten frozen contracts, exact/stale/source mismatch, empty/malformed/injection, missing scanner evidence, independent actor denial, dependency cycles, complete human fixture, automated ZIP fixture, actual local HTTP GET, timeout, permission denial and response size/type limits.

Initial `npm run typecheck` passed for NICO; a later concurrent tree check found only unrelated optional-browser errors. Parent owns final integrated typecheck, registry integration, CI and exact production-safe qualification. Positive NICO behavior here was verified with isolated fixtures, not claimed as current NICO production behavior.

## Kernel integration

Attach boot-only `context.nicoObserver = createNicoReadObserver(existingNicoClient,{environment:'PRODUCTION'})`. The runner returns optional `capturedEvidence: readonly EvidenceRecord[]` for the parent to validate, audit, persist and retain without upgrading provenance. Actual production evidence requires an explicit matching native deployment identity in the captured NICO response. No inferred health endpoint, caller URL, credential input, model-provided adapter or independent approval actor is accepted.
