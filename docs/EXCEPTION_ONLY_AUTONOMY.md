# Exception-only autonomy work card

Status: CANARY candidate; inactive until the authenticated owner activates a time-bounded mandate.

## Objective

Reduce routine owner work without creating a second policy authority or granting SARA open-ended commercial, financial, identity, credential, or platform authority.

## Initial standing mandate

- Service: `public-repository-readiness-snapshot` only.
- Duration: 30 days; explicit renewal required.
- Cost: $0 per routine action.
- Volume: at most 10 decisions per UTC day.
- Concurrency: one.
- Eligible actions: public opportunity research, SHADOW business-candidate development, inbound reply preparation, calendar scheduling, and bounded outreach.
- Eligible channels: owner site, email, calendar, and an approved API. A listed channel is usable only after its connector is separately configured and verified.
- Emergency stop: blocks all autonomous work.

## Exceptions and hard boundaries

Out-of-scope actions produce a durable owner exception. Money transfer, financial-account creation, credential access, impersonation, and platform-prohibited automation are denied and cannot be enabled by this mandate. Custom contracts require exact owner approval.

The existing paid lane remains unchanged: confirmed payment and exact owner approval are required for fulfillment; separate owner delivery approval remains required for the first five paid reports. Refunds, wallet transfers, payment-destination changes, new accounts, legal-entity actions, and final legal commitments remain owner-controlled.

## Capability truth

This release adds durable authority evaluation, exception routing, a one-tap owner mandate control, conservative platform defaults, and a zero-cost SHADOW business incubator. It does not claim that Gmail, Google Calendar, WhatsApp, or marketplace accounts are connected. Those capabilities stay unavailable until owner-controlled OAuth/business credentials and direct production acceptance exist.

## Acceptance criteria

- Mandates are versioned by digest, time-bounded, revocable, restart-safe, and hash-chain audited.
- Missing, expired, revoked, mismatched, over-budget, over-volume, and concurrent actions fail closed.
- Constitutional protected actions cannot be delegated by a mandate.
- SHADOW business candidates cannot create accounts, contact customers, accept contracts, spend, deploy, or mutate production.
- Owner status exposes the current mandate, exceptions, and candidate artifacts.
- Existing paid-service, payment, fulfillment, delivery, emergency-stop, CI, and CodeQL gates remain green.
