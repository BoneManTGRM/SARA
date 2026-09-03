# SARA NICO Comprehensive operator

SARA can create and advance an authorized, anonymous/read-only NICO Comprehensive assessment for one public GitHub repository pinned to an exact commit. The owner API can inspect run status, retrieve reports, open the review queue, submit the owner's exact-draft approval, authorize client delivery separately, and download the certified package.

## Production configuration

Set `SARA_NICO_BASE_URL=https://app.nicoaudit.com/api/nico/` and a long random `SARA_NICO_OPERATOR_PASSWORD` on the private SARA operator service. Configure that same value as `NICO_SARA_OPERATOR_PASSWORD` only on NICO's private backend. It is SARA's scoped service password, not NICO's master admin password.

SARA loads her service password from the deployment secret store and passes it as NICO's `X-NICO-Admin-Token` header. It is never written to SARA state, memory, audit events, logs, tool descriptors, URLs, or responses. An authenticated owner may supply a one-request override, but normal operation requires no password entry. Telegram and the read-only bridge cannot invoke these endpoints.

## Owner API sequence

1. `POST /api/nico/runs` creates the exact-SHA public intake.
2. `GET /api/nico/runs/{run_id}` reads the authoritative run state.
3. `POST /api/nico/runs/{run_id}/continue` advances at most one bounded stage.
4. `GET /api/nico/runs/{run_id}/report/{markdown|html|json|pdf}` retrieves a draft artifact.
5. `POST /api/nico/runs/{run_id}/review-queue` reads protected review work using the ephemeral password.
6. `POST /api/nico/runs/{run_id}/finalize` approves only when `confirmExactReport` is true and `expectedArtifactIdentity` matches the current NICO artifact.
7. `POST /api/nico/runs/{run_id}/authorize-delivery` is a distinct owner confirmation for client delivery and requires the exact artifact identity again.
8. `POST /api/nico/runs/{run_id}/approved-package` downloads the certified package with the ephemeral password.

NICO remains the authority for specialist review, stale-artifact rejection, report compilation, and delivery certification. SARA cannot manufacture a reviewer identity, approve a changed report, bypass NICO's review state, or authorize delivery under a standing mandate. The emergency stop freezes all NICO network activity.

## Client-facing status language

The intended final presentation is `Authorized` only after both exact-report review and separate delivery authorization succeed. Before then, use `Pending Review` or `Approved — Delivery Pending`. `Controlled` describes the governed process, not a fully completed client-facing result.
