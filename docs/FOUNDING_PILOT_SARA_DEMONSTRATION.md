# Unpaid demonstration — Public Repository Readiness Snapshot

Status: SHADOW owner-review sample · no customer involved · no publication, delivery, remediation, or payment authorized

Repository: `https://github.com/BoneManTGRM/SARA`

Immutable revision: `5a1144cb795789964d54d6fb8bcded9fb90462c0`

Compiled report SHA-256: `bf24280d90ad216d06cc37be17a9b077d5de75c9b3565c2558bcc286379e468d`

## Why this sample exists

The $149 founding pilot has a deterministic report gate and a public-proof compiler, but a buyer still needs to see a concrete example of the deliverable. This sample uses SARA's own public repository so no customer data, account, outreach, or permission claim is required.

GitHub's current secure-use guidance says that a full-length commit SHA is the only immutable way to reference an action and recommends granting `GITHUB_TOKEN` only the minimum required permissions. Those public controls make the two observations below reproducible and relevant:

- [Secure use reference — GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use)
- [Use GITHUB_TOKEN for authentication in workflows](https://docs.github.com/actions/reference/authentication-in-a-workflow)

These sources support the recommendations. They do not prove customer demand, validate the $149 price, or establish that this bounded sample found every repository risk.

## Sample result

Readiness: **attention required**

Evidence coverage: code, dependencies, secret-exposure sample, and release controls were reviewed across four public files. Repository settings, security alerts, complete history, private data, and production systems were not inspected.

### High — CI action dependencies use movable version tags

The primary CI workflow references `actions/checkout@v4` and `actions/setup-node@v4`. GitHub documents full-length commit pinning as the immutable option.

Evidence: [`.github/workflows/ci.yml` lines 12–13](https://github.com/BoneManTGRM/SARA/blob/5a1144cb795789964d54d6fb8bcded9fb90462c0/.github/workflows/ci.yml#L12-L13)

Recommended next step: after owner review, pin each third-party action to a verified full commit SHA and retain the release tag in a comment.

### Medium — Primary CI token permissions are implicit

The primary CI job does not declare a `permissions` block. Its effective token permissions therefore depend on repository or organization defaults.

Evidence: [`.github/workflows/ci.yml` lines 8–18](https://github.com/BoneManTGRM/SARA/blob/5a1144cb795789964d54d6fb8bcded9fb90462c0/.github/workflows/ci.yml#L8-L18)

Recommended next step: after owner review, explicitly grant only the permissions required by this test job, such as read-only repository contents.

## Limitations

- This is an unpaid demonstration with no customer or testimonial.
- It is a bounded review of one named public revision, not a complete repository or history audit.
- It is not penetration testing, remediation, certification, legal advice, or a security warranty.
- The absence of another finding is not evidence that other risks do not exist.
- The compiler produces a private owner-review artifact and authorizes neither external delivery nor publication.

## Safest next step

The owner should compare both findings with the immutable source and decide whether this example accurately represents the paid deliverable. Only then may the existing public-proof compiler prepare a separately reviewed public sample.
