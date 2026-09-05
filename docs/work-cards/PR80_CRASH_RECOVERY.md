# PR80 current-main integration and fail-closed crash recovery

## Acceptance

An expired claimed testing role with no durable output must not dispatch again.
An unresolved role reserves its pinned role budget in the owner-testing monthly
admission calculation even after the calendar month changes. A matching persisted
artifact remains recoverable without a new model call. Unknown lease roles and
invalid receipt costs must fail integrity validation before admission.

## Implementation boundary

The existing private testing job's active lease is the unresolved reservation;
no separate ledger or owner authority is introduced. The held value is the pinned
runtime role ceiling (work director/specialist/delivery $0.05; verifier $0.10).
Changing these role limits in a future release requires preserving old unresolved
claims' conservative bounds. Expiration alone never clears the reservation.
This release does not add a discretionary API for waiving unresolved cost.
Completion from a validated persisted output reconciles actual accounted cost.

The private store synchronizes directory entries after atomic job replacement,
before any provider dispatch. Existing owner-only, no-charge, no-external-delivery,
no-revenue and emergency-stop boundaries remain. One owner runtime process per
state directory is required; multi-process concurrent writers are not supported.
The testing server facade is opt-in and no separate testing budget or production
caller is enabled by this integration.

## Verification record

Seven new crash/accounting tests: six failed for the intended missing behavior;
the existing saved-output recovery control passed. After repair all seven passed.
Combined crash and owner HTTP suites passed10/10 using a disclosed temporary
TypeScript5.8.3 transpilation hook in a credential-free Node22.16 process. This
local run is not the locked-dependency full verification or the final CI gate.
Full locked CI and CodeQL are required on the published integrated head.

No real model generation, production job, delivery, or new spending grant occurred.
