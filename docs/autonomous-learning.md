# Bounded learning queue

This is engineering preparation, not a qualified autonomous learner. The latest real-model Catalog Import Loss Audit attempt failed proposal parsing. No catalog acceptance or restart/reuse result exists. New regression tests use labeled fixture generators and establish controller behavior only.

## What runs automatically

The existing runtime can consume authorized self-development jobs marked with the `autonomous-learning` required capability. It chooses the highest declared owner value first; that value is a prioritization input, not measured profit. Existing jobs, kernel-private audit storage and the Genome Lab verifier remain authoritative. No new backend, account or paid service is introduced.

Each job gets one generator request. At most two reservations per UTC day are permitted, further restricted by the existing mandate's daily ceiling. Reservation precedes dispatch and remains consumed on failure. Running or ambiguously reserved jobs block further learning; restarting cannot silently reset accounting. An actual candidate metadata, source, compiler or behavioral rejection may queue one follow-up for a positive-declared-value objective. The child preserves the exact objective, acceptance criteria and budget; durable parent/root identity prevents duplicate descendants. A failed child cannot spawn another child. Unknown provider/parser failures do not trigger recursion. Both generations share the daily reservation ceiling. This first implementation consumes a delegated backlog; it does not autonomously invent a curriculum or discover customer demand.

Successful kernel verification retains a SHADOW artifact and a durable skill-memory record linked to its digest. Skill memory can be recalled after restart; it explicitly distinguishes producer-test verification from external acceptance and profit. It does not pass the separate catalog acceptance fixtures, install an operational skill, authorize ordinary-interface execution, or promote production. Existing operational routing correctly excludes this unpromoted pure-skill fixture. Exact owner promotion remains mandatory.

## Evidence-informed attempts

The kernel stores a bounded safe failure observation with job identity, exact objective digest and candidate digest when a proposal existed. Recalled failures are sent only for the identical objective, with at most four 1,500-character observations. They are explicitly untrusted evidence. Relevance filtering can omit older records; this is bounded memory, not exhaustive recall. Model responsiveness remains unqualified.

Parser diagnostics now report the number of independently parseable object candidates and allowlisted finish/token metadata. Zero candidates cannot by itself distinguish truncation from malformed syntax. Raw provider content, reasoning and credentials are not logged. The free generator retains its model, temperature, requested seed, JSON mode and 8,192 completion ceiling. Requests now have a twelve-minute transport timeout, below the existing fifteen-minute workflow ceiling. A requested seed remains best effort, not deterministic model execution.

## One-time activation requirements

Deployment remains off by default. Before enabling, review and merge the engineering change, qualify one real generated artifact against the frozen contract, and establish a target-bound authenticated mandate. Do not overwrite an existing commercial mandate just to turn on learning.

The active mandate must explicitly include action `business_candidate_development`, channel `internal`, service `skill-learning`, zero cost per action, concurrency one and an expiry. Use authenticated `POST /api/autonomy/learning-mandate`, which creates a zero-cost internal-only learning mandate valid for thirty days through the existing exact approval mechanism. The older `/api/autonomy/standing-mandate` route is scoped to commercial work and does not authorize learning. An active different mandate blocks this request; explicitly reconcile it rather than silently replacing it. Existing restrictions and owner identity are unchanged.

On the existing runtime only, configuration requires `SARA_AUTONOMOUS_LEARNING_ENABLED=true`, `SARA_WORKERS_PLAN=free`, and the existing restricted `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`. Never publish credentials. No paid fallback exists. Queue public-safe learning objectives through the existing authenticated objective interface with `autonomous-learning` in `requiredCapabilities`; keep private acceptance answers out of objectives and producer tests. A timer checks the backlog each minute without a model call when no eligible work exists.

Emergency stop prevents dispatch and acceptance through the existing kernel. Mandate revocation is checked before and after generation. Disabling the worker stops future ticks; an already dispatched request may still complete, so use emergency stop to prevent its acceptance. An uncertain reservation requires inspection and explicit reconciliation; this patch does not automatically erase or retry it.

## Remaining qualification

Run one newly authorized free diagnostic on the reviewed source, at most two requests through the existing manual workflow. If it returns an eligible candidate, run the frozen six development checks, then select at most one candidate for the sixteen untouched acceptance cases and restart/new-input reuse. If no candidate appears, preserve the result and use the new safe diagnostics to select the next change. Do not claim revenue, a paid pilot, or independent repair discovery from fixture tests.


## Owner model-spending control

Authenticated `GET /api/model-budget` shows the UTC month, configured cap, reserved allowance and remaining allowance. Authenticated `POST /api/model-budget` accepts explicit numeric `monthlyLimitUsd`, `openingChargeUsd`, `inputUsdPerMillionTokens`, and `outputUsdPerMillionTokens`. Amounts must be whole cents between zero and fifty dollars; token prices must be positive reviewed USD per million tokens. The exact request receives target-bound owner approval through the existing kernel policy. There is no default spending authorization: an unconfigured gate blocks runtime paid generation.

Before activation, the owner must choose the cap, review the actual provider prices for the configured model, and include a conservative opening charge for current-month prior usage and outstanding calls. Editing the cap does not erase reservations or permit lowering the opening charge. Existing narrower per-job and Telegram limits still apply.

The runtime's owner assistant, startup proof, revenue operator and coding-client factory share kernel reservations. Each request reserves its entire maximum token cost before generation. Reservations survive process failure and are not refunded even when reported usage is lower. This conservative reserved amount is not the provider invoice or actual spending. Usage is recorded separately; reported token bounds violations freeze further paid dispatch pending investigation. A persisted allocation renews per UTC calendar month. Requests are attributed to the month in which they reserve, which can differ from provider invoice timing. The gate adds an input-count request before each generation and cannot make provider timing deterministic.

No account, hosted tools, paid calls, configuration, mandate or worker was activated while developing this change. Standalone scripts outside the runtime, other applications using the same API key, provider price changes and existing unrecorded charges are outside the gate. Live benchmark scripts remain paused. Keep credentials restricted and account-level billing controls in place. This is API usage; ChatGPT subscription billing is separate. Disabling prepaid auto-recharge does not itself enforce an immediate usage cutoff.
