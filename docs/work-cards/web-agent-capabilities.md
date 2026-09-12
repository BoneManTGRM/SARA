# Web and cooperative agent capability wave

Implement seven web and seven agent collaboration capabilities through the existing capability registry, authority checker and durable evidence receipts. Supplied pages, forms, attachments and agent manifests are untrusted data. No outbound agent communication, form submission, financial commitment, credential access, security change or public publication is authorized.

Web acceptance: explicit browser step plans, supplied source-bound page-state extraction, sandbox form representations, exact-state independent verification, actual decoded-pixel comparison, checkout detection and shared boundary classification. The sandbox adapter uses the existing Chrome DevTools protocol style, blocks network and page scripts before loading supplied HTML, permits only reading a bounded DOM or preparing sandbox fields, and rejects submission. This adapter requires an installed browser supplied by the trusted host; a mocked protocol test does not prove a real browser ran.

Agent acceptance: advertise only current kernel-qualified enabled capabilities, treat discovered manifests as unverified assertions, compile bounded contracts, independently verify exact contract/revision outputs, retain task-specific verified history as kernel receipts, partition resource ownership without overlapping mutations, and rank independent proof rather than votes. No external-agent allowlist or transferable authority is created.

Read Vercel agent-browser skill. Local inspection found no agent-browser or Chrome/Chromium executable and no new dependency is added. Existing scripts/browser-observer.ts is preserved.

## Local evidence

- Initial RED: `node --import tsx --test tests/web-capabilities.test.ts tests/agent-capabilities.test.ts` failed because both implementation modules were absent.
- Web focused GREEN: `node --import tsx --test tests/web-capabilities.test.ts` passed 5/5, including fourteen frozen cases, hidden effects and credentials denial, actual decoded-pixel comparison, invalid image dimensions, source mismatch, unsafe links, redacted fields, cyclic plans and injection boundaries.
- Agent focused GREEN: `node --import tsx --test tests/agent-capabilities.test.ts` passed 6/6, including fourteen frozen cases, exact contract/revision/artifact/cost provenance, failed evidence dominance in task-specific reputation, correlated sources, proof-supported minority versus unsupported majority, prohibited delegation, and nested write/read resource conflicts. The resource conflict test was observed RED before correcting the overlap detector.
- Integration RED: four real kernel tests failed on absent registry implementations.
- Integration GREEN: `node --import tsx --test tests/agent-capabilities-kernel.test.ts tests/web-capabilities-kernel.test.ts` passed 4/4 after registry and readiness integration. Real contracts expose only current qualified capabilities. Synthetic owner-observed exact contract and cost proof feed result verification, durable reputation and copied-backup replay. Exact web observation proofs establish only the matching revision. Authority, costs and state boundaries remain intact.
- Final affected run: `node --import tsx --test tests/web-capabilities.test.ts tests/web-capabilities-kernel.test.ts tests/agent-capabilities-kernel.test.ts` passed 9/9. `npm run typecheck` passed.

## Required actual-browser CI proof

Command: `node --import tsx src/digital-capabilities/web/browser-qualification.ts`.

Local execution failed with `SANDBOX_BROWSER_UNAVAILABLE`; no browser proof is claimed locally. The CI command must run on a host with sandbox-capable `google-chrome`. It launches the real browser with its sandbox intact, verifies scripts and local-trap network requests are blocked, reads actual DOM, prepares a nonsensitive sandbox field, refuses sensitive fields and submission, compares actual browser screenshots before/after, checks the decoded-pixel comparator separately, and invokes the real kernel `website-state-reader` with supplied HTML. Missing browser is a failure, not a skipped pass.

`website-state-reader` optionally accepts `sandboxHtml` only with `page.sourceUrl` under `sandbox:` and `page.revision = sha256(html)`. This route uses a fresh temporary browser profile with no inherited credentials, no URL navigation, network blocked, scripts disabled, downloads denied and restrictive CSP. Default snapshot analysis remains inexpensive. Missing browser or protocol failure returns incomplete evidence without network fallback. No `--no-sandbox` flag is used.

Current scope is supplied snapshots and isolated supplied-HTML rendering. No general live-site browsing authority or external-agent allowlist was introduced. Existing owner-started browser-observer integration remains unchanged. Actual CI/browser execution and deployed safe-runtime proof are parent integration gates.

## Final boundary review

Two focused RED cases exposed uppercase password/hidden field values and credential-bearing source URLs. Sensitive textarea descendants were also excluded from DOM text extraction. The repair normalizes field types, prunes sensitive subtrees, rejects credential query keys, strips fragments, bounds DOM traversal and masks sensitive fields before screenshots. The required actual-browser fixture includes these cases. Nineteen affected web/agent tests and TypeScript passed; the reconciled inventory/runtime suite passed 21 tests. The separate browser command still failed locally with `SANDBOX_BROWSER_UNAVAILABLE` and remains a mandatory CI gate.

## Actual Chrome handle repair

PR #178 head `a58722bf` passed its 1,347 main tests and 14 runtime tests, then real browser qualification failed at the first field preparation: screenshot redaction and DOM refresh invalidated a saved frontend node ID. Two focused RED cases reproduced this failure and showed that a reused frontend number could address a different node.

Snapshots now expose CDP backend node identity. Field preparation verifies the exact backend node in a current snapshot, retains all sensitive/type restrictions, and resolves a fresh frontend handle with `DOM.pushNodesByBackendIdsToFrontend` immediately before mutation. Screenshot masking uses the same resolution after each preceding redaction. Missing, sensitive, detached and unresolved identities fail closed. The real browser fixture retains the original backend handle across redaction, so the failing acceptance path remains exercised.

`node --import tsx --test tests/web-capabilities.test.ts tests/web-capabilities-kernel.test.ts` passed 12/12. `npm run typecheck` passed. Real Chrome qualification must be rerun in CI against the repaired head; no local browser proof is claimed.

## Bounded Chrome endpoint readiness

PR #178 head `7732dcf` passed 1,349 main tests and 14 runtime tests, then the real browser gate failed while its first Chrome process was still alive: no complete endpoint had been accepted within the previous 2.5-second startup loop. That loop also stopped on the first readable file, including a partial write.

An extracted readiness helper first reproduced the delayed-start failure and invalid-port acceptance in focused RED tests. The integrated helper now uses a single 10-second monotonic deadline, continues through missing, partial and invalid endpoint files, validates the complete browser UUID and TCP port, and immediately fails when the same child exits. It launches no replacement process, retains the existing 30-second overall browser lifetime, and changes no sandbox or network restriction. Injected-clock fixtures cover delayed publication, truncated UUID, invalid port, exact timeout and early child exit.

`node --import tsx --test tests/web-capabilities.test.ts tests/web-capabilities-kernel.test.ts` passed 14/14. `npm run typecheck` passed. Required actual Chrome qualification remains the CI acceptance gate.
