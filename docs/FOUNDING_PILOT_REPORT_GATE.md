# $149 founding pilot report gate

Status: SHADOW candidate · owner review required · no customer contacted · no delivery or payment action

## Opportunity

The Public Repository Readiness Snapshot already has intake, public evidence collection, bounded model work, independent verification, and an owner-review stop. Its remaining product risk is the final report boundary: a fluent draft could cite a moving branch, omit a review category, overstate safety, or appear ready for delivery without a deterministic check.

GitHub's public documentation supports the four review categories used by the offer:

- [Code scanning](https://docs.github.com/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/about-code-scanning) analyzes repository code for vulnerabilities and coding errors.
- [Dependency review](https://docs.github.com/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review) describes dependency changes and their security impact.
- [Secret scanning](https://docs.github.com/code-security/secret-scanning/about-secret-scanning) checks Git history for known forms of hardcoded credentials.
- [Secure use of GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use) documents workflow security controls and risks.

These sources establish that the categories are legitimate. They do not prove demand for this service or validate the $149 price.

## Deliverable

`compileRepositoryReadinessReport` converts structured evidence and findings into one deterministic owner-review report. It:

1. requires exactly one evidence record for code, dependencies, secret exposure, and release controls;
2. accepts citations only from the named public repository at the exact 40-character commit;
3. requires every finding to cite source lines;
4. rejects duplicate records, excessive findings, and unsupported safety, compliance, certification, or penetration-test claims;
5. sorts the report deterministically and does not mutate the input;
6. represents unavailable categories as evidence gaps and stops before owner review; and
7. always returns `externalDeliveryAuthorized: false`.

A reviewed sample with no findings is labeled only `baseline_observed`. The fixed limitations explicitly say that absence of a finding is not evidence that vulnerabilities, exposed secrets, or release risks do not exist.

## Falsifiable value

For the first three paid owner-approved pilots, record whether the compiler catches a missing category, moving citation, duplicate finding, or unsupported assurance before owner review. If it catches none and adds more than ten minutes of human work per report, simplify or retire the gate. If it prevents one material correction while keeping preparation inside the three-hour delivery ceiling, retain it as part of the reusable offer.

## Safest next step

Run the report compiler only after the existing evidence collector pins a public repository revision. The owner then reviews every finding and separately decides whether any customer-facing delivery should occur. This candidate performs no outreach, repository mutation, deployment, payment activity, or delivery.
