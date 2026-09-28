# Owner project-memory bridge for saraseed.app

Baseline: main dcfb6ac3df4bc02ffeaf8c1ef566c619e1e0d630. Owner asked to make the existing Jev-style SARA second brain useful through saraseed.app, with OpenRouter funding deferred until tomorrow night. No paid call or new infrastructure is authorized in this candidate.

Acceptance: separate SHA-256-bound project bridge credential, distinct from owner, read-only catalog and Telegram action tokens; exactly one read-only GET returns a bounded, source-linked project brief; unknown project and oversized query fail closed; unauthenticated, wrong credential, POST and unrelated APIs stay denied. Site requires a valid owner session, never exposes bridge secret to browser, and shows an unavailable state until configured. Existing Jev OpenRouter model adapter and owner-controlled budget gate are unchanged. No model routing claim or live qualification until funded and separately tested.

Proof: strict typecheck; focused HTTP access test; full npm run verify on frozen candidate. Site tests verify owner session and backend projection. Source digest and exact results belong in PR description. Rollback: revert code and leave durable SARA memories and budget events untouched. CANARY and exact owner approval remain required for operator promotion.

## Harness review applied to this work

The owner supplied [Learn Harness Engineering](https://github.com/walkinglabs/learn-harness-engineering) as a design reference. Its instructions, state, verification, feedback, and session-lifecycle framing maps to this candidate as follows; this is our assessment, not a copied course template.

- Instructions and scope: this work card and `AGENTS.md` define the one project-brief read surface. No arbitrary endpoint, general agent execution, automatic posting, or spending route is added.
- Tools and state: the bridge can only request a bounded GET; SARA's existing event store stays canonical. A browser handoff is a disposable view, never a new memory authority.
- Verification and feedback: require tests for wrong credentials, unsupported operations, invalid project and oversized query; site must show unavailable if the bridge fails. A passing local suite is not proof that the live canary returns current project evidence.
- Lifecycle: record the exact candidate tree, CI result, canary observation and rollback path before production promotion. An interrupted deployment or request is not a completed handoff; reconcile the live state before retrying.
- Jev qualification after funding: choose one explicitly approved public-query relevance task, compare its shadow suggestions with local source-linked retrieval, record cost and uncertainty, and leave owner approval and record order unchanged until a separate measured decision. No external model receives owner-private project text by default.

This read-only bridge has no multi-agent graph. Add branching, parallel workers, or a new harness service only when a measured task needs them and its state, cancellation, recovery, and approval edges are specified.
