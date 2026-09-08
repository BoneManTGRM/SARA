# Proposed judge-only fixture access

Status: engineering qualification candidate under the owner’s benchmark request.
No production or paid benchmark activation is authorized by this work card.
The general producer isolation rule remains unchanged; this candidate addresses
a required read-only public fixture in the independent official judge.

Evidence: workflow 34173241960, artifact kernel-official-7-34173241960.
Its stock report records PASS_TO_PASS failure for the existing issue-4999 query
parsing test, which calls Postman Echo and fails name resolution. The distinct
issue-5028 FAIL_TO_PASS test uses localhost. A localhost mapping cannot satisfy
the required external fixture. Do not skip, edit, mask, or reclassify either test.

Proposed exception:

- Apply only to frozen-patch official judges for axios__axios-5085, including
  both reference controls and both comparison arms. Producer containers remain
  completely offline. No official results reach an active producer.
- Permit only an absolute-form GET to https://postman-echo.com:443/get with a
  bounded query through a separate proxy; CONNECT is denied. No arbitrary hosts, raw IP targets, redirects to other hosts, private
  addresses, cloud metadata, host network, or published inbound ports.
- Put the judge on an internal network with isolated gateway mode (no host
  bridge address), with only the proxy reachable. Prevent
  direct external routes and DNS egress; do not simply enable Docker's normal
  outbound network. The proxy independently resolves and validates the fixed
  public destination and has no access to owner state or provider credentials.
- Keep no host mounts, no provider/owner secrets, dropped Linux capabilities,
  no-new-privileges, existing CPU/memory/process limits and fresh containers.
  Any proxy settings are fixed by the trusted judge adapter, never the patch.
- Bound each judge to 32 connections, 1 MiB each direction per connection and
  30 seconds per connection, inside the existing overall grading deadline.
  Failure or cleanup uncertainty cannot produce a passing control.
- Pin the proxy implementation/image and network-policy digest in registration
  and receipts. Retain connection counts, denied destinations, bytes and cleanup
  results without logging private credentials or treating them as model usage.

Acceptance before paid execution: original base must demonstrate the expected
failure while preserving PASS_TO_PASS; the published reference must resolve;
blocked-host/direct-egress/private-address probes must fail. Repeat both arms
under the same pinned judge policy. This is not a grant for any model calls,
extra hosting or monthly expense. Other compatibility failures and the matched
producer remain separate completion requirements.
