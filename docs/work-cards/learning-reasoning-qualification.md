# Bounded completion-policy qualification

Owner requested continuation after PR143. PR143 merged as 3517577bf4fef72a2f8b2e65cabe7a255177003d. Invocation 34270907088 returned no initial proposal: finish_reason=length, prompt_tokens=605, completion_tokens=8192. It stopped after one request; no repair was possible. The one-invocation grant is consumed. Do not start another provider invocation or treat the unused maximum second request as a new workflow grant.

Observed limit: this provider response reached the fixed completion ceiling without final candidate content. It does not reveal the internal token allocation. The merged feedback fix was not exercised by this run. All catalog development/acceptance/restart qualification remains unrun.

Hypothesis for the next controlled experiment: requesting the model's documented low reasoning effort may allow final output within the same 8192-token ceiling. Source: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/ (read 2026-09-08). Support in documentation is not proof this provider/model honors it or that repairs improve.

Prepare exactly one opt-in request variable through the existing free-model generator and manual workflow. Default behavior stays identical. Accept only current/default or low; record the selected mode before each request in the existing evidence receipt. Preserve model, prompts, temperature, seed request, completion ceiling, two-request maximum, fifteen-minute workflow limit, verifier, authority and no-paid-fallback rule. Do not introduce another runner or automatically retry missing content.

Engineering acceptance: fixed-input requests are identical except reasoning_effort=low when explicitly selected; default requests omit the field; invalid configuration fails before dispatch; evidence records the same selected setting and still refuses more than two attempts. Focused tests and npm run verify must pass. This accepts experiment preparation only, not a successful model setting.

Future live gate, frozen before any provider execution: one workflow invocation with low selected, at most two requests, original catalog objective and acceptance set, no paid fallback. Record response completeness and every gate. No candidate means reject the usefulness hypothesis for that run, not raise token limits. A complete candidate still requires all existing tests and independent acceptance. Older stochastic trials are descriptive comparisons only; a causal A/B claim would require a separately authorized matched comparison.

Four methods: minimal no-content failure; one optional request variable under fixed inputs; critique distinguishes response completeness from useful learning; prompt content/order unchanged and reordering remains unrun because the live invocation allowance is exhausted. No generated catalog code or expected answer is edited by Codex.
