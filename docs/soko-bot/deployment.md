# Soko Bot deployment

Deploy `apps/soko-bot` as own Vercel project with that directory as project
root.

Provisioned (2026-08-24, team `masumi`):

- Project `sokosumi-soko-bot-preprod` (`prj_GKX9jtdK4b4WX2RMnPXKa6GyDwAF`),
  root directory `apps/soko-bot`, Node 24. Runtime URL
  `https://soko-bot-preprod.preview.sokosumi.com` (custom domain, so Vercel
  SSO deployment protection does not apply to Core → Eve calls).
- Runtime env set for Production + Preview: `SOKO_BOT_CORE_BASE_URL` and
  `SOKO_BOT_TOKEN_ISSUER` = `https://preprod.api.sokosumi.com` (Core preprod
  `BETTER_AUTH_URL`), `SOKO_BOT_SIGNING_PUBLIC_KEYS` = key ring with
  `soko-bot-preprod-v1`.
- Deploy from the repo root with the root linked to that project
  (`vercel link --project sokosumi-soko-bot-preprod`, then `vercel --prod`);
  deploying from inside `apps/soko-bot` fails the root-directory check.
- Core preprod (`sokosumi-core-preprod`) needs the matching
  `SOKO_BOT_*` variables (see below); keep `SOKO_BOT_ENABLED=false` on
  Production until the branch is deployed and a canary turn has passed on
  Preview. Eve build emits Vercel Build Output, including web runtime, Workflow, and
Vercel Sandbox template configuration.

Required runtime environment:

- `SOKO_BOT_CORE_BASE_URL`: Core origin.
- `SOKO_BOT_TOKEN_ISSUER`: must exactly equal Core `BETTER_AUTH_URL`. Core's
  token factory uses `BETTER_AUTH_URL` as signed token issuer.
- `SOKO_BOT_SIGNING_PUBLIC_KEYS`: JSON key ring accepted by Eve.
- Vercel project OIDC enabled. Core allowlists this project/environment through
  `SOKO_BOT_EVE_PROJECT_ID` and `SOKO_BOT_EVE_ENVIRONMENT`.

Required Core production environment:

- `SOKO_BOT_ENABLED=true` only after enabled preview/staging canary checks.
  Production flag is global; repository has no per-user rollout gate.
- `SOKO_BOT_RUNTIME_ADAPTER=eve`.
- `SOKO_BOT_RUNTIME_BASE_URL`: explicit remote HTTPS Eve URL, plus
  `SOKO_BOT_RUNTIME_VERSION`.
- current EdDSA private signing key/id plus previous public keys for rotation.
- `SOKO_BOT_CREDITS_PER_USD` and `SOKO_BOT_MIN_TURN_CREDITS`.

Required Vercel Connect setup for account integrations:

- Create separate Google and Microsoft connectors for preprod and production;
  link each connector only to its matching Core Vercel project/environment.
- Set `SOKO_BOT_GOOGLE_CONNECTOR_UID` to the Google connector UID (normally
  `oauth/<name>`) and `SOKO_BOT_MICROSOFT_CONNECTOR_UID` to the Microsoft UID
  (`microsoft/<name>`) on Core. Omitting one leaves that provider unavailable.
- Google needs delegated `gmail.readonly` and `calendar.readonly`; Microsoft
  needs delegated `Mail.Read` and `Calendars.Read`. Do not grant write scopes.
- Core receives `VERCEL_OIDC_TOKEN` automatically on Vercel. Local connector
  testing requires linking the Core project and refreshing the development
  OIDC token with `vercel env pull` before it expires.
- Provider tokens and refresh tokens stay in Vercel Connect. Do not copy them
  into Core environment variables or persist them in Postgres.

Core startup treats `NODE_ENV=production` or
`VERCEL_ENV=preview|production` as deployed. When Soko Bot is enabled there,
environment validation rejects the in-memory adapter, non-HTTPS runtime URLs,
and localhost/loopback/wildcard runtime hosts. `NODE_ENV=development` keeps the
in-memory adapter and `http://localhost` available for local development and
tests. With `SOKO_BOT_ENABLED=false`, these deployment-only constraints do not
block boot, preserving the operational kill switch.

Verification:

1. `pnpm --filter @sokosumi/soko-bot-runtime typecheck`
2. `pnpm --filter @sokosumi/soko-bot-runtime test:ci`
3. `curl https://<runtime>/eve/v1/health`
4. With preview/staging `SOKO_BOT_ENABLED=true`, start signed canary turn
   through Core; verify Context fetch, Task delegation, session waiting
   boundary, usage charge, and admin runtime inspection.
