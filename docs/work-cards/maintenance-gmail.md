# Maintenance Gmail delivery adapter

Continue the owner-authorized unattended maintenance workflow after PR132. Use the existing SARA mailbox identity and the existing Gmail OAuth configuration convention. No new accounts, changed secrets, new spend, NICO changes or mail dispatch are authorized by tests.

Acceptance: accept only a real kernel job at NOTIFY_INTENT with a verified candidate and deployment receipt; recipient fixed to Cody for the gift pilot; verify exact Google sender identity before dispatch; serialize sends with durable attempt/receipt files in the existing job artifact folder; reconcile accepted sends after restart and refuse replay of uncertain attempts; honor emergency stop immediately before send. Test fixtures must be identified as offline and cannot establish live delivery. No runtime activation until a complete publisher/provider is connected.

Implemented MaintenanceGmailNotifier accepts only kernel-authorized gift jobs at NOTIFY_INTENT and checks the exact persisted deployment receipt and candidate digest. It sends a fixed plain-text completion message to reparodynamics@gmail.com after verifying sara.reparodynamics@gmail.com through Google's identity endpoint. It never reads inbox messages or accepts an arbitrary recipient.

The notifier uses existing clientId/clientSecret/refreshToken conventions: SARA_GMAIL_OAUTH_CLIENT_ID, SARA_GMAIL_OAUTH_CLIENT_SECRET and SARA_GMAIL_REFRESH_TOKEN. No variables were installed or changed. The ChatGPT Gmail connector remains connected but its credentials are not exposed to this runtime.

Delivery attempts and receipts live under the existing job artifact directory. Exclusive file locking serializes concurrent sends; the pre-dispatch intent and provider-acceptance receipt are synced durably. An uncertain attempt cannot automatically resend, even after owner resumption of the maintenance job; it requires separate evidence-based reconciliation. Acceptance is not proof of inbox delivery or reading.

This component is not wired into main's null maintenance provider. A trusted project publisher must supply publish/findPublication/readPublished/rollback/findRollback and bind the notifier's notify/findNotification methods before activation. No secret-management shortcut or NICO sender contract change is introduced.

Production checkpoint: PR132 commit 5a1144cb795789964d54d6fb8bcded9fb90462c0 deployed successfully as Railway deployment 95f7e92d-1d08-4025-b22c-24ff7e41c25a. /health returned 200 with Constitution verified, and unauthenticated maintenance readiness/jobs requests returned 401. Those checks prove release health/access protection, not unattended fulfillment.

Verification: focused Gmail tests 5/5, npm run verify exit 0 with 1,021/1,021 tests and all integrated proofs passing; typecheck and git diff --check pass. All Gmail responses in tests were injected fixtures; no real email dispatched.

{
  "src/maintenance-gmail.ts": "09525fd911fe2e35b84f8a2768d507d4f2ddbefdb0247df52f9dfb5ed9f6b81e",
  "tests/maintenance-gmail.test.ts": "ad2d2586e003b1faa808c687b28e8842333c634ec2d4142eef43c80fd6f28912"
}
