# Developer CLI OAuth slice

**Date:** 2026-09-07
**Branch / PR:** `sok-909-connect-existing-responses-api-coworkers-to-organization` (#4016)
**Linear:** [SOK-909](https://linear.app/masumi/issue/SOK-909/connect-existing-responses-api-coworkers-to-organization-workspaces)
**Status:** Draft — first implementable slice of `apps/cli`

## Problem Statement

A Coworker developer cannot sign in from a terminal on Sokosumi today. Web `/developer` has Better Auth. Core already is the OAuth authorization server (`/auth/oauth2/authorize`, `/oauth2/token`). `apps/cli` on `main` is only `VISION.md`. The sibling `sokosumi-cli` is a different product and stays read-only.

Without a first-party native public client, `sokosumi auth login` has no `client_id` to send. Developer → OAuth clients creates a confidential web client owned by that user, which the CLI cannot use.

## Solution

Ship a Developer CLI in `apps/cli` (package `sokosumi-cli`, binary `sokosumi`). Slice 1 is login/signup only:

- `sokosumi auth login` opens the system browser, runs PKCE against Core, stores OAuth tokens in the OS keychain.
- `sokosumi` with no args launches a thin Ink screen: signed out → Sign in; signed in → who you are + Sign out.
- Signup and password login happen on existing web `/signin` during the authorize hop. The CLI does not collect email or password.
- Core seeds a platform-owned native public client `sokosumi_cli` so a stranger does not create an OAuth client first.

Coworker connect/enable/status stay later slices. No marketplace Agent/Hire/Job surface.

## User Stories

1. As a Coworker developer, I want `sokosumi auth login` to open my browser, so I can sign in without pasting an API key.
2. As a new Coworker developer, I want the same browser hop to let me create a Sokosumi account, so I do not need a separate CLI signup form.
3. As a Coworker developer, I want `sokosumi` with no args to show whether I am signed in, so I can see session state without reading the keychain.
4. As a Coworker developer, I want to sign out from that screen, so the next person on the machine cannot use my token.
5. As a Coworker developer, I want login to work without creating a client under Developer → OAuth clients, so the first run is `npx` / local binary, not a dashboard chore.
6. As a Coworker developer, I want refresh tokens in the keychain, so a restart does not force another browser hop while the refresh token is valid.
7. As a Coworker developer on scripts, I want `sokosumi auth login --json`, so CI-adjacent tools can detect success without parsing prose.
8. As a Coworker developer, I want `SOKOSUMI_OAUTH_CLIENT_ID` to override the baked id, so preprod or a private client still works.
9. As a Coworker developer, I want the CLI to talk only to Core HTTP, so it never needs database credentials.
10. As a Coworker developer, I want this binary to be the only shipping CLI in the monorepo, so I do not maintain a second product.

## Implementation Decisions

- Home: `apps/cli` on this monorepo. Do not change or publish `masumi-network/sokosumi-cli`.
- Package identity: name `sokosumi-cli`, bin `sokosumi`. VISION’s `package.json` gate is this spec.
- Auth: Better Auth OAuth authorization code + PKCE + loopback `http://127.0.0.1/oauth/callback` and `http://[::1]/oauth/callback` (RFC 8252 §7.3 port variance; CLI listens on 53682 by default). Never register `localhost`.
- Scopes: `openid sokosumi:api offline_access`. Consent stays on (`skipConsent: false`) because `/oauth/consent` runs workspace prep.
- Public native client: `token_endpoint_auth_method: none`, `application_type: native`, `requirePKCE: true`, `userId: null`, stable `clientId: sokosumi_cli`.
- Core seeds that row with Prisma upsert (Better Auth `oauthProvider` has no client seed list; `adminCreateOAuthClient` needs a session and issues a random id). Deploy: `ensure:cli-oauth` after migrate; hourly cron `/sync/first-party-oauth-clients`; non-fatal boot on `serve()`.
- Token store: OS keychain for access + refresh only. No API key mint in this slice. Fallback file only if keychain APIs fail.
- CLI must not import `@sokosumi/database` or Prisma. Shared constants live in `@sokosumi/utils`.
- Ink is slice 1 for login/status only. No dashboard, agents, tasks, or coworker views.
- Copy OAuth/keychain/Ink patterns from the sibling CLI. Do not copy its marketplace command surface.
- Local untracked `apps/cli` copies on this branch are not the product. Replace them when implementing this spec.

## Testing seams

Highest seams (prefer these; inject I/O):

1. **OAuth protocol** — build authorize URL, validate state, exchange code, refresh. Inject `fetch` and time.
2. **Auth manager** — get/set/clear tokens. Inject keychain.
3. **Headless command** — `runCli(["auth", "login"])` with injected `loginFn`.
4. **Boot route** — `selectBootRoute({ showLogo, authResolved, hasAuth })` → `logo | boot | auth | signed-in`.
5. **First-party client upsert** — Core helper with mocked `oauthClient.upsert`; assert `sokosumi_cli`, native, `none`, loopback redirects, `userId` null.

Do not require a live browser or a real Core in unit tests. A later manual pass: `pnpm --filter sokosumi-cli start` against preprod after the client row exists.

## Testing Decisions

- Test observable behavior: stored token after a mocked callback, `--json` shape, boot route, upsert payload.
- Do not assert Ink markup snapshots as the contract.
- Prior art: sibling `sokosumi-cli` `test/auth/oauth.test.mjs`, `test/auth/bootstrap.test.mjs`; Core route tests that mock Prisma.

## Out of Scope

- Sibling repo changes or npm publish of `masumi-network/sokosumi-cli`
- Marketplace TUI (agents, hire, jobs, dashboard)
- Coworker connect / enable / status / key rotate
- Minting a Better Auth API key into `~/.sokosumi/config.json`
- CLI-native email/password signup
- Dynamic client registration
- Replacing web `/developer`

## Further Notes

Ask-matt route for the rest of SOK-909: this spec is slice 1. Coworker connection contract, Responses runtime, web onboarding, MCP, and public listing stay in the parent plan. Implement slice 1 on a focused PR if the planning PR should stay docs-only; otherwise land constants + seed on Core first so login can be demoed.
