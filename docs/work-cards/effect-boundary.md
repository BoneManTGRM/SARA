# Shared effect boundary

Baseline: a33d69b5e286a9d3308a99496270d0e0fb4ae03d.

Contract: existing policy and exact standing-mandate evaluators remain the only authority sources. A shared final boundary rejects unknown actions, hidden external effects, and unmandated external writes. Every decision retains exact action/target, source authority identity, side effects and denial reason in its existing audit route. No external content or capability result is an authorization token.

Implementation: extend existing policy finalization, routine decisions and Telegram/NICO mandate finalization; preserve existing owner/authentication, emergency-stop, budgets and denial codes. Add trusted actor-visible referenced capability results for stateful reasoning, using existing hash-checked receipts and no new store.

Acceptance: unknown action/unmandated write/hidden effect rejected; existing exact owner and mandate routes still pass their regression suite; stale/forged receipts cannot grant state or authority. Full CI and exact-deployment harmless proof required for integration.
