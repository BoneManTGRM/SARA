# Production activation: Telegram NICO and SARA Gmail

This capability remains inactive unless every required production variable and the exact owner mandate are present. No variable value belongs in source control, logs, Telegram, browser-visible code, reports, or model memory.

## Required protected Railway variables

- `SARA_TELEGRAM_OWNER_USER_ID_SHA256`: SHA-256 binding for Cody's already-paired Telegram identity.
- `SARA_TELEGRAM_NICO_MANDATE_APPROVAL`: exact value `SARA_TELEGRAM_NICO_AUTOMATED_DELIVERY_V1_OWNER_APPROVED_2026-09-04`.
- `SARA_GMAIL_OAUTH_CLIENT_ID`: Google OAuth client identifier for the production callback.
- `SARA_GMAIL_OAUTH_CLIENT_SECRET`: Google OAuth client secret.
- `SARA_GMAIL_OAUTH_REDIRECT_URI`: exact protected HTTPS callback ending in `/api/gmail/oauth/callback`.
- `SARA_RAILWAY_PROJECT_TOKEN`: temporary production-environment project token used only to install `SARA_GMAIL_REFRESH_TOKEN`; it is cleared in the same successful installation mutation.

Existing protected variables remain authoritative for the Telegram bridge, NICO operator, state directory, emergency stop, budgets, and owner controls.

## One-time Gmail authorization

1. Cody submits the authenticated Telegram OAuth-start action from the already-paired identity.
2. SARA returns a single-use Google authorization URL that expires after ten minutes.
3. Cody authorizes only while signed into `sara.reparodynamics@gmail.com`.
4. SARA exchanges the code using PKCE and verifies the fresh authenticated identity.
5. Any identity other than `sara.reparodynamics@gmail.com` is rejected and no token is installed.
6. The refresh token is installed as a protected Railway variable; the temporary Railway project token is cleared; Railway restarts the service.
7. SARA verifies `sara.reparodynamics@gmail.com` again immediately before every authorized report send.

Google consent does not itself start an assessment or send an email.

## Delivery boundary

The only production report route is:

- sender: `sara.reparodynamics@gmail.com`
- recipient: `reparodynamics@gmail.com`
- attachment: the unchanged independently verified NICO automated package

Provider acceptance may be recorded as sent. Inbox delivery is not claimed without separate evidence.
