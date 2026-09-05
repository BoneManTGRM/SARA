# PR93 integration: reusable mechanisms, historical live trial retained

Original branch head: a59facdfbaf05f35d8a4e0c87c5758cb5c003d76. The completed
V8 trial ran a6d47883b06fcf0b5a5c6e9dde4595dcc1765df4, not this new integration.
Its consumed contract is
5fabd97aeb58eaa82cbe87395b533fe1636d42fbb1acda6a513b185cddabdfc2.

## Integrated capabilities

`ExperimentalCompilerCache` now retains bounded, content-keyed immutable external
declaration text only. The post-merge corrective review reproduced unsafe mutable
AST reuse and callback-context collisions, so parsed SourceFile objects are no
longer shared. Every request is parsed afresh with its current options; every call
still creates a fresh Program/checker and executes behavioral verification afresh.
Omitting the optional parameter keeps the ordinary implementation. No production
or frozen benchmark caller constructs or passes a cache. A text-cache hit is not
a parse saving or performance claim. See `POST_MERGE_CORRECTIVE_REVIEW.md`.

`GuardedRepairMemory` retains exact-source, scope-bound, verified recipes with
quarantine and fresh-verification requirements. It remains an in-memory proof
mechanism, not global production learning or cross-arm benchmark memory. The
original tests run it through the actual controller and unchanged verifier.
New tests first exposed weak boolean, named-scope and evidence-digest validation;
those boundaries are now strict. Candidate file identities are unique and
unknown strategy values cannot widen the surgical mutation budget.

## Not imported or enabled

Do not import the branch's `railway.json`: it selects a historical V8 process.
No V8 worker/approval/startup file, live/reuse activation workflow, Cloudflare
reader, generated owner grant, recurring benchmark, or research runner is
installed. Those artifacts and their original failures remain in Git history.
The retired SSH stack is superseded by PR99, not a prerequisite for this merge.
The compiler/frontier simulations remain historical research, not new trials.

The recorded historical pair passed 50 original assertions for each arm. Its
1.4029268257 ratio compared compact-first with full replacement under the same
controller. It is not this continuation's trial, a general multiplier, or proof
of unique Reparodynamic advantage. The reported $0.0034504 was a token estimate,
not reconciled billing. Preserve the post-hoc compact-artifact input-validation
limitations and the unverified Telegram delivery status in the PR discussion.

No model call is made by this integration. Neither the consumed V8 grant nor
the current $0.15 unresolved allocation is released. Full regression/CodeQL
checks must bind this integrated tree, not the historical branch head.
