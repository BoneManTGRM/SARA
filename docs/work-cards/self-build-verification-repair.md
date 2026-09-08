# Self-build verification repair

Owner request: fix the rejected self-build and unavailable-browser notices shown in screenshots. Prior PR137 was closed during backlog cleanup; recover only its verified six-file operational repair onto current main 5a1144cb795789964d54d6fb8bcded9fb90462c0. No recovery experiments or benchmark runner changes are included.

Failure: task7c3a6b53-35c1-42a3-9dc5-83988f5aa7c2 reached repository verification and failed. Its stored digest matches a verification exit1 error. A clean checkout reproduces missing tools/native-checker dependencies, which root npm ci does not install. The existing pinned checker setup fixes that prerequisite. Do not claim every historical failing check was recovered.

Changes: prepare pinned verifier before claiming work; retain safe stage/output digests and trusted workflow link; stop on uncertain result recording without a contradictory second write. Existing authority, budget, verification and historical task state are preserved.

Validation: focused executor/publisher tests, full npm run verify against main plus this repair, exact-head remote CI and CodeQL. Submit one small repair PR for the previously authorized merge after required checks pass. Dashboard/Telegram notices are a separate existing Sites source change. No production deployment, paid calls, benchmark launch, or historical-task replay occurs without resolving the earlier explicit deployment boundary.
