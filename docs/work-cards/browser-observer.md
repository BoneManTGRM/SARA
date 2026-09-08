# Bounded browser observation

Owner request: add real browser streaming to SARA, retaining existing resources and privacy.

This is a new, owner-started public-page browser check. It does not turn file repairs into browser work or demonstrate autonomous browsing. The existing standard public-repository GitHub runner hosts installed Chrome; no provider, model, hosting subscription, artifact archive, or credentials are added. One rollout check runs when browser-observer code is merged; further checks are manual. No scheduled runs, form submissions, owner login, private APIs, merge, task replay, or benchmark activation.

Acceptance: a main-branch, first-attempt manual or browser-code rollout run captures real Chrome JPEG frames from the fixed SARA home and pilot pages; at most 30 frames, two seconds apart, 140,000 base64 characters per frame, a 90-second server lease and a four-minute workflow ceiling. Only owner-authenticated dashboard reads can see the latest frame; stale/expired/ended sessions lose their image. The locked screen receives only coarse activity. Browser-workflow OIDC cannot claim repairs; repair-workflow OIDC cannot publish browser frames.

Verification: request and execution boundary tests; existing full repository gate; site SQLite/authentication/expiry/replay/size tests; exact-head remote CI and CodeQL. A real owner-started main workflow is required to qualify browser-to-dashboard transport beyond local tests. Preserve failed runs and do not claim streaming was demonstrated unless that run supplies frame acknowledgments. The browser check must be explicitly labelled separately from ordinary SARA task execution.

References: https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot and https://docs.github.com/en/billing/concepts/product-billing/github-actions . Standard hosted runners are free for public repositories; the workflow refuses a private-repository invocation. Chrome sandbox stays enabled, its process does not inherit workflow tokens, and its fresh profile is removed afterward.
