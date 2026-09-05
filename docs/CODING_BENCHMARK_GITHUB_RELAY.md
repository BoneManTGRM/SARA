# Bounded authenticated launch connection for the existing coding benchmark

## Work card and acceptance

Owner request: make SARA ready to run the coding benchmark, while preserving the
original equal-arm $0.15 ceiling, unknown-spend hold, owner controls and one-use
execution. The existing Railway connection cannot perform authenticated HTTP or
exec. This change supplies only a scoped authentication adapter to the two
existing benchmark endpoints; it does not introduce another runner or service.

A GitHub-hosted workflow may read readiness and request the existing launch only
when a Railway-configured permit pins its exact commit and the deployed runtime.
The existing server-owner digest AND kernel-owner authentication remain required;
their actual credential stays inside Railway. The existing task, controller,
provider adapter, protected tests, launch gate, durable claim and accounting are
unchanged. No new money is authorized by the relay or its permit.

## Disabled unless explicitly configured

`SARA_CODING_BENCHMARK_GITHUB_RELAY_PERMIT_JSON` accepts exactly:

- `schemaVersion: 1`
- the existing `benchmarkId`
- a 40-character `runtimeRevision` matching `RAILWAY_GIT_COMMIT_SHA`
- the exact 40-character `workflowRevision`
- integer UTC epoch-second `notBefore` and `expiresAt`, at most one hour apart

There are no task, model, budget, grant-renewal, command, file-path, or owner
credential fields. Clearing the variable or its expiration disables the relay.
Deployment and issuing a permit require the owner's existing Railway authority.
Existing owner-token access is unchanged and does not require this permit.

Tokens must be GitHub RS256-signed, have the exact benchmark audience, immutable
SARA repository/owner IDs and owner actor ID, the pinned workflow/ref/source,
`push` event, GitHub-hosted execution and `run_attempt: "1"`. Only the specific
`verify/coding-benchmark-owner-relay-20260905` ref and
`.github/workflows/coding-benchmark-owner-relay.yml` are admitted. Pull requests,
forks, other workflows, reusable-workflow delegation and rerun attempts fail.
Signing keys are fetched only from GitHub's fixed HTTPS JWKS endpoint, with
redirects disabled, a timeout and a response-size bound. Public keys are cached;
authorization decisions are not. Permit/runtime changes and expiry are checked
again after key retrieval. Failed key retrieval fails closed.

The relay authenticates ONLY GET `/api/coding-benchmark/readiness` and POST
`/api/coding-benchmark/run`, with no query string. It cannot authenticate general
owner operations, emergency-stop controls, tools, Telegram, NICO or Gmail.
Readiness and the owner launch receipt record the signed launch identity, never
the JWT or the owner/provider credentials. The original exclusive durable launch
claim, including failed starts and unknown outcomes, still prevents replay.

## Live verification boundary

A first connection test must require readiness to report the existing unresolved
$0.15 exposure and zero available authorization before issuing one rejection-only
POST. If readiness is unexpectedly true, stop before POST. The expected 423
`UNRECONCILED_MODEL_EXPOSURE` is evidence of a working authenticated rejection
path, NOT a successful coding run or a paid authorization. Preserve all outcomes;
no automatic retry and no recurring workflow. The workflow stays outside main.

An operationally cleared paid benchmark still requires authoritative records
resolving the original request, or a separately explicit new owner authorization
that preserves rather than erases the unresolved history. This change does not
implement such a new grant or change the current hardcoded spending hold.

## Verification scope

Added tests cover real RSA signatures, altered signatures, algorithm/key-source
confusion, owner/repository/workflow/source/time mismatches, expired/revoked/
expanded permits, failed/ambiguous/oversized key responses, asynchronous revocation,
and concurrent key fetches. HTTP tests exercise the real SARA server/kernel:
scoped authenticated readiness, retained spending hold, zero launch-file changes,
ordinary-route denial, both owner layers and immediate credential/permit removal.
Provider traffic is replaced by a rejecting fixture; these are not model trials.
All original acceptance tests and source protections must remain unchanged.
Require full exact-candidate CI, CodeQL and integrated review before merging.

Primary implementation references: GitHub OpenID Connect reference and its
published issuer metadata at `https://token.actions.githubusercontent.com/.well-known/openid-configuration`.

## Real issuer compatibility correction

The first live transport proof (33996630519) received 401 on readiness and stopped
before POST. Its failure is retained. A separate issuer-only diagnostic
(33996944716) made no SARA or model requests and established the concrete cause:
GitHub supplied `job_workflow_ref` and `job_workflow_sha` even for this inline job,
with values equal to the same fixed workflow path and exact source revision. The
original verifier rejected any presence of either field, before fetching keys.

Admission now accepts their joint absence or their exact matching self-workflow
pair. Partial, malformed, mismatched or other reusable-workflow pairs still deny
before key retrieval. All other issuer, signature, immutable identity, source,
event, expiry, route and original spending-hold checks remain unchanged. Seven
additional regressions retain the positive reproduction and six denied variants.
No historical spending is resolved by this authentication correction.
