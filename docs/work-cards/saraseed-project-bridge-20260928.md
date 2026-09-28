# Owner project-memory bridge for saraseed.app

Baseline: main dcfb6ac3df4bc02ffeaf8c1ef566c619e1e0d630. Owner asked to make the existing Jev-style SARA second brain useful through saraseed.app, with OpenRouter funding deferred until tomorrow night. No paid call or new infrastructure is authorized in this candidate.

Acceptance: separate SHA-256-bound project bridge credential, distinct from owner, read-only catalog and Telegram action tokens; exactly one read-only GET returns a bounded, source-linked project brief; unknown project and oversized query fail closed; unauthenticated, wrong credential, POST and unrelated APIs stay denied. Site requires a valid owner session, never exposes bridge secret to browser, and shows an unavailable state until configured. Existing Jev OpenRouter model adapter and owner-controlled budget gate are unchanged. No model routing claim or live qualification until funded and separately tested.

Proof: strict typecheck; focused HTTP access test; full npm run verify on frozen candidate. Site tests verify owner session and backend projection. Source digest and exact results belong in PR description. Rollback: revert code and leave durable SARA memories and budget events untouched. CANARY and exact owner approval remain required for operator promotion.
