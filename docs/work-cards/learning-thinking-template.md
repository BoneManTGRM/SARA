# Bounded thinking-template qualification

Baseline: a566695bfadf137c4497d4aa5a8540532554d2ad (merged PR144). Its low-effort catalog invocation, run 34277889474, returned no candidate content at the 8192-token ceiling after one request. The provider's internal token allocation and whether it honored reasoning_effort are unknown. The catalog skill remains unqualified.

The upstream GLM-4.7-Flash chat template has a separate enable_thinking generation-prefix control. Cloudflare's model schema exposes chat_template_kwargs. Read on 2026-09-08:
- https://huggingface.co/zai-org/GLM-4.7-Flash/blob/main/chat_template.jinja
- https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/

Hypothesis: requesting chat_template_kwargs.enable_thinking=false may yield complete candidate content within the existing ceiling. These sources do not establish that Cloudflare applies the option. No content, an unsupported setting, or an unparseable proposal would fail the response-completeness goal for that invocation. A complete proposal alone is not skill qualification.

Implement one opt-in control, current or disabled, through the existing generator, manual workflow and pre-dispatch evidence receipt. Default/current must omit chat_template_kwargs and preserve the request. Invalid settings must fail before dispatch without echoing their value. Do not accept arbitrary template arguments or alter prompts, source policy, compilation, behavioral verification, rollback, memory, publication authority or retries.

Engineering acceptance, frozen before implementation: compare complete requests for the same input under current and disabled, both with and without the existing low setting; the only delta must be chat_template_kwargs={enable_thinking:false}. Keep this setting on the existing repair path. Ensure the receipt persists it before a response, never asserts provider compliance, preserves earlier bytes, and cannot create a third attempt. Verify errors do not cause retry or fallback. Run focused checks and npm run verify.

The future live diagnostic retains the original catalog objective, model @cf/zai-org/glm-4.7-flash, reasoning_effort=low, temperature=0, requested seed=1, max_completion_tokens=8192, JSON-object response, no streaming, fifteen-minute workflow limit, at most one invocation and two requests. Seed is best effort, not deterministic execution. This is one variable relative to v6; cross-run outcomes are descriptive, not a matched causal estimate. Do not raise limits after a negative result.

Keep the original six development and sixteen held-out cases and their hashes. Freeze an eligible model-produced artifact and its own tests before evaluating it. Require every acceptance case, no input mutation, existing independent verification, exact saved source/digest across restart, and execution on new input without a model call. Ordinary authorized retrieval/invocation must be demonstrated separately; manual re-import is narrower. No candidate means these checks are unrun. Codex must not supply the implementation and call that learning.

Four methods: use the minimal historical no-content failure; make one request-setting change under fixed conditions; critique response completeness separately from behavior and reuse; retain exact prompt reorderings as unrun because they would require a separate meaningful live comparison. At most one development experiment and one frozen candidate in this cycle.

The runner and executor remain restricted to protected main. Do not dispatch from a branch, relax this guard, or bypass it with local credentials. Publish a reviewable draft and obtain target-specific merge authority before using the new option live. Prior consumed invocations do not renew an allowance. No paid calls, new services, production promotion, NICO changes, benchmark execution, customer contact or commercial claims.
