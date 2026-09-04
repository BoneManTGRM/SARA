# SARA NICO Comprehensive operator

SARA can create and advance an authorized, anonymous/read-only NICO Comprehensive assessment for one public GitHub repository pinned to an exact commit. She can also request a certified `Authorized Automated Technical Assessment` package without a human specialist when NICO reports zero unresolved review-work units and the exact artifact identity still matches.

For the fixed $149 Public Repository Readiness Snapshot, the production revenue operator now invokes this automated path after SARA's independent verifier and deterministic report compiler pass. It derives one deterministic NICO run ID from the paid job, reuses the exact collected commit, advances the run across restart-safe ticks, accepts only the exact artifact identity, and stores the certified package by digest before authorizing customer delivery. The customer receives a separate authenticated download URL for that package. If NICO has any review-required work, stale identity, target mismatch, missing package digest, or unavailable credential, fulfillment stops without delivery.

## Production configuration

Set `SARA_NICO_BASE_URL=https://app.nicoaudit.com/api/nico/` and a long random `SARA_NICO_OPERATOR_PASSWORD` on the private SARA operator service. NICO holds only the password's SHA-256 verifier. It is SARA's scoped service password, not NICO's master admin password.

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

For the no-specialist tier, steps 6–8 are replaced by `POST /api/nico/runs/{run_id}/authorize-automated-delivery`. SARA confirms the exact artifact and the automated-service disclosure. NICO releases the package only when the unresolved review workload is zero; otherwise it stops without an authorized report.

NICO remains the authority for stale-artifact rejection, report compilation, zero-review-work enforcement, and delivery certification. SARA cannot manufacture a reviewer identity, approve a changed report, or turn unresolved review work into an authorized automated report. The emergency stop freezes all NICO network activity. Human-reviewed Comprehensive remains available as a separate optional tier.

## Client-facing status language

The automated final presentation is `Authorized — Automated Technical Assessment`. It must also say `Human reviewed: No` and must not claim certification. The separate human-reviewed tier uses `Authorized` only after exact human approval and delivery authorization both succeed. `Controlled` is not a completed client-facing status.
