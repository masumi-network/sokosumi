# SOK-948 First-party CLI OAuth client

> Implement on PR #4016 (`sok-909-connect-existing-responses-api-coworkers-to-organization`). Do not mix coworker-connect WIP into this commit.

**Goal:** Core always has a platform-owned native public client `sokosumi_cli` so SOK-949 can run `auth login` without each developer creating an OAuth client.

**Architecture:** Prisma upsert of Better Auth’s `oauthClient` table. Same row authorize/token already read. Deploy hook after migrate, hourly cron, non-fatal boot seed.

**Tech stack:** `@sokosumi/utils`, Core Prisma, Vercel cron `/sync/first-party-oauth-clients`.

**Spec:** `docs/superpowers/specs/2026-09-07-developer-cli-oauth-slice-design.md`  
**Linear:** [SOK-948](https://linear.app/masumi/issue/SOK-948/provision-first-party-oauth-client-for-cli-login)

## Global constraints

- Stable public id `sokosumi_cli` (not a secret)
- Native, `token_endpoint_auth_method: none`, PKCE, `skipConsent: false`
- Redirects `http://127.0.0.1/oauth/callback` and `http://[::1]/oauth/callback` (no port)
- `userId` null, no client secret
- Scopes `openid sokosumi:api offline_access`
- CLI does not import Prisma; Core owns the seed

## Files

- `packages/utils/src/oauth-first-party-cli.ts` — constants + write payload
- `apps/core/src/helpers/first-party-cli-oauth-client.ts` — upsert
- `apps/core/scripts/ensure-first-party-cli-oauth-client.mts` — deploy
- `apps/core/src/routes/sync/first-party-oauth-clients/get.ts` — cron
- `apps/core/src/index.ts` — non-fatal boot
- `apps/core/package.json` — `ensure:cli-oauth` on `vercel-build`
- `apps/core/vercel.json` — hourly cron

## Next

SOK-949 on the same PR: `apps/cli` package, `auth login`, thin Ink, keychain.
