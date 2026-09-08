# Matched repository comparison on existing cloud services

This candidate uses the existing Railway SARA service and its `/data` volume as
the only kernel, owner, evidence and spending authority. Standard GitHub jobs run
the existing Docker sandboxes. Provider and owner credentials stay on Railway.
No new service, volume, larger runner or recurring hosting commitment is needed.

GitHub currently provides standard public-repository runner usage without charge
and free container-registry storage/bandwidth. These are the resources used here:
[Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[container billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages).
The existing Railway deployment and account limits remain applicable.

## Evidence before owner activation

`repository-cloud-images.yml` builds each unchanged public base, runs the public
tests with cgroup exhaustion checks, and publishes only a passing image to GHCR.
It pulls the registry digest and checks that its image ID equals the tested ID.
The initial ten-image sweep is run `34181675503`. Retain failed evidence and use
the subsequent passing qualification for any changed recipe.

`repository-cloud-qualification.yml` exercises actual Docker sessions over HTTP,
fresh verification, poisoned-workspace rejection and persisted-artifact tamper
rejection. Its separate official control produces twenty **scripted fixture**
outcomes for one case, freezes them, and checks the official base/reference
results through the worker transport. These are qualification controls, not
twenty SARA attempts. Loopback qualification does not attest Railway connectivity.

Use the retained official base/reference controls for all ten selected cases.
The preparer reads only the public issue from each base input; it never reads a
reference patch into the producer package. Arrange each public artifact under
`public/0` through `public/9`, and each official-control artifact under
`controls/0` through `controls/9`, then compile the reviewable package:

```sh
node --import tsx scripts/prepare-repository-cloud-package.ts \
  --public /path/to/public --controls /path/to/controls \
  --source GITHUB_COMMIT_TO_DEPLOY \
  --workflow-ref refs/heads/run/swe-cloud-UNIQUE_RUN \
  --not-before ISO_UTC_START --expires ISO_UTC_END \
  --output /path/to/repository-cloud-package.json
```

The source is the exact GitHub commit to deploy, not a local commit with a similar
tree. The compiler checks all ten qualified images and official controls, freezes
the twenty task/arm rows, code bindings, image digests, Luna settings and prices,
and prints the package, registration and authority digests. It creates no claim
and grants no spending. The validity window is at most 72 hours.

The proposed cap is $15.60 total, $7.80 per arm and $0.78 per attempt. Both arms use
gpt-5.6-luna at medium reasoning, at most 50 generations, 30,000 input and 8,000
output tokens per generation, 200 tools, six public tests, 2 MiB of observations,
and thirty minutes per attempt. The registered $0.20/$1.20 per million token
snapshot is conservative accounting, not an invoice or an activated allowance.

## Exact owner action after qualification

AGENTS.md and the Constitution require target-bound owner approval for promotion
and protected authority configuration. First present the final source and package
digests, validation evidence and exact cap. Do not install an activation or deploy
the candidate on the strength of this document.

After that owner approval, configure the **existing** service with the package
JSON as `SARA_REPOSITORY_BENCHMARK_PACKAGE_JSON` and its digest as
`SARA_REPOSITORY_BENCHMARK_APPROVED_SHA256`. Deploy the exact reviewed source on
that service and volume. The existing owner can launch using
`POST /api/repository-benchmark/run` with `packageDigest`, `registrationDigest`
and `authorityDigest` through normal owner authentication.

For connector-operated launch without moving credentials, the owner may also
explicitly authorize `SARA_REPOSITORY_BENCHMARK_LAUNCH_SHA256` with that same
package digest. The existing service authenticates its existing owner credential
and enters the same one-use kernel launch at boot. Approval alone never launches;
the separate launch mandate is required. Restart sees the durable claim and
refuses replay. Readiness and results remain owner-authenticated routes.

Only after the service records its launch claim, create the package's exact
`run/swe-cloud-*` branch at the reviewed commit. Its push starts the pinned
workflow without first installing unapproved code on main. OIDC admits only that
source/ref/workflow, the owner's immutable actor/repository IDs, the first run
attempt and one durably bound GitHub run ID. Neither workflow possession nor a
worker token grants owner or provider access.

Twenty serial producer jobs each handle one attempt and its fresh verification.
Twenty serial judge jobs follow only after the producer jobs and the durable
twenty-row freeze. The 120-minute job bounds preserve the attempt ceiling within
GitHub's six-hour job maximum. Both arms pull their same registered image digest.
No paid work resumes after a process restart, missing worker, changed authority,
uncertain dispatch, or conflicting response. Exposure and failed/unrun outcomes
remain recorded. Do not rerun failed jobs to manufacture a complete comparison.

The final comparison is available at `/api/repository-benchmark/result` and in
the existing durable `repository-trace/comparison-result.json`. Publish success
rates only for the complete twenty-row result, with failures, token/cost evidence,
timings and the small ten-task paired-sample limitation. Until then: **0/20 real
attempts run; no benchmark winner or superiority claim.**
