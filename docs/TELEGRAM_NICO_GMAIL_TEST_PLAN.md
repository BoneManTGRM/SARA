# Telegram NICO and Gmail verification matrix

The release gate must execute these cases on the exact pull-request head before merge.

## Telegram boundary

- Ordinary `/api/telegram/luna` remains analysis-only and is not intercepted by the action bridge.
- Missing bridge authentication is rejected.
- A Telegram identity other than Cody's paired identity is rejected before any GitHub, NICO, Gmail, or Railway boundary call.
- Only the five supported structured actions are accepted.
- Arbitrary URLs, branch paths, tags, abbreviated revisions, malformed SHAs, credential-bearing fields, and changed replay payloads are rejected.
- Concurrent or restarted requests reuse the original durable assessment and NICO run identity.
- Emergency stop, owner revocation, inactive mandate, daily limit, concurrency limit, and assessment cost limit fail closed.

## NICO boundary

- The public repository and exact 40-character commit are independently resolved before run creation.
- Every run, continuation, terminal record, queue, artifact, and package remains bound to the same run, repository, commit, artifact schema, artifact ID, revision, digest, and size.
- Automated authorization requires exactly zero unresolved review workload.
- Human-review claims or implications are rejected from the automated path.
- Package bytes, content type, digest, manifest, report entry, and automated-delivery disclosure are independently verified.
- Stale, incomplete, inconsistent, review-required, unsupported, or unverifiable packages are not stored as verified and cannot be emailed.

## Gmail boundary

- OAuth requests only OpenID email identity and `gmail.send`.
- OAuth uses PKCE, expiring single-use state, and rejects every identity except `sara.reparodynamics@gmail.com`.
- The refresh token is installed only through Railway's protected variable API; the temporary Railway project token is cleared in the same mutation.
- Delivery is fixed to `sara.reparodynamics@gmail.com` -> `reparodynamics@gmail.com`.
- The report digest is recomputed immediately before MIME construction, and the verified bytes are attached unchanged.
- A fresh authenticated sender-identity check occurs immediately before Gmail submission.
- Provider rejection is not recorded as success; an ambiguous provider result is not automatically resent.
- A completed duplicate returns the original non-secret provider-acceptance receipt without a second send.

## Regression gate

The complete repository verification suite must remain green, including owner API, revenue, self-build, Reparodynamic coding canary, NICO operator, HTTP, persistence, and security behavior.

No test or CI workflow may perform the live p-map assessment, request Google consent, or send an email.
