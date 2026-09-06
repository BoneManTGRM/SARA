# Observed coding and bounded verifier experiment

Owner: continue SARA speed hardening toward dependable 35x verified exact-repeat throughput.
Base: 4adf3c149030d2984807753caac24d62521d6b80. SARA only; NICO/PR69 excluded.

## Acceptance
1. A new versioned benchmark counts underlying generation invocations even if the repair callback fails.
2. Authority revoked or signal aborted before dispatch counts zero invocations. Intent is explicitly not acknowledgement.
3. Uncertain execution retains reservation, closes the suite and never retries. Old runner, grants and evidence stay unchanged.
4. Full HTTP self-build timing includes request handling through response finish after kernel acceptance and its required receipts; it is observational telemetry, not cached acceptance authority or evidence of client receipt.
5. Compare serial versus two fresh verifier workers in a credential-free prototype. Preserve all checks; report startup, every observation and failure. Do not activate worker scheduling in production until actual benefit and kernel authority integration are qualified.
6. Full npm verify and exact-head CI/CodeQL required before source-only deployment. All configuration, accounts, budgets and volumes preserved.

## Live boundary
One new trial may use the existing $0.15 ceiling only after independent new grant registration and exact-source OIDC preflight. Equal 60-second provider deadline is a preregistered new protocol, not a retroactive retry or evidence of faster inference. No consumed grant is reusable. A component-level run cannot establish the complete-job 35x target.

## Measured scheduling result and selection
The fixed six-pair/two-fixture experiment completed all checks. Serial work took
12.831534s versus 10.949766s for two workers (1.17185x). Including the two-check
initialization it was 1.02977x. This is NOT a complete SARA job comparison and does
not support 35x. The pool therefore remains a non-production experiment; no kernel
acceptance or verifier selection is changed. An initial run overlapped the full
regression suite accidentally and was declared excluded before reading its
aggregate; all raw observations and that exclusion are retained.

## Provider hardening
The existing Gemini client's preflight now calls the exact target model's
countTokens endpoint rather than equating UTF-8 bytes with tokens. It bounds
input and response allocations, rejects invalid/absent/unsafe numeric counts,
refuses redirects, and enforces the response-body deadline. Failure has no byte
fallback and is not a generation request. This is tokenizer admission evidence,
not independent reconciliation of billed generation tokens. No Gemini credential
or live Gemini request is added. Luna settings and frozen adapters are unchanged.

## New trial registration
Fresh benchmark 68990425-bf42-4ec5-a4f1-e6af301780ac is capped at $0.15 total /
$0.05 each arm and uses a separately versioned observed runner. Existing frozen
runner, grant objects, protected tests and implementation pins remain unchanged.
It repeats the same three-arm/four-round component workload learned from empty
isolated memory, with equal 60-second response deadlines including body reads.
A timeout/uncertain generation closes the suite with held exposure; no paid
retry. There is no comparison of optimized kernel parallelism because no such
change is installed. Outer HTTP telemetry will be active for normal self-build
requests, but this dedicated component trial cannot qualify its full lifecycle.
