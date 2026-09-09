# Public Repository Readiness preflight

Status: SHADOW candidate. This change does not deploy or activate public checkout.

## Opportunity

Let a prospective buyer determine whether one public GitHub repository fits the fixed `$149 Public Repository Readiness Snapshot` before creating a payment intent. The result is a qualification card, not a reservation, invoice, acceptance, or promise of work.

GitHub documents a read-only repository endpoint for retrieving repository metadata. Public resources can be requested without authentication, subject to GitHub's limits. GitHub currently documents a primary limit of 60 unauthenticated requests per originating IP address per hour:

- <https://docs.github.com/en/rest/repos/repos#get-a-repository>
- <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>

SARA keeps its stricter existing public-commerce limit of five attempts per client per hour.

## Contract

`POST /api/public/revenue-pilot/preflight` requires:

- one canonical `https://github.com/owner/repository` URL;
- one of `security_baseline`, `release_readiness`, or `dependency_health`;
- explicit true/false answers for repository authority, private access, private or regulated data, production changes, and exploit validation.

The server reads only GitHub's public repository metadata, rejects private, archived, redirected, transferred, malformed, or activity-undated repositories, and feeds the verified repository facts into a deterministic compiler. The response preserves the fixed price, deliverables, exclusions, risks, information gaps, and next step.

Every response sets both `mayCreatePaymentIntent` and `mayBeginWork` to `false`. An eligible result means only that the buyer may separately review the exact current terms and decide whether to create a payment intent.

## Acceptance evidence

- Focused compiler and HTTP tests cover eligible, unsafe, missing-authority, incomplete-answer, deterministic, non-mutating, and no-ledger-mutation behavior.
- The existing CORS boundary, fixed terms, payment verification, owner fulfillment approval, delivery approval, and emergency stop remain unchanged.
- No account, credential, customer record, payment, outreach, deployment, or production mutation was created while preparing this candidate.
