# Soko Bot deployment

Deploy `apps/soko-bot` as own Vercel project with that directory as project
root. Eve build emits Vercel Build Output, including web runtime, Workflow, and
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
