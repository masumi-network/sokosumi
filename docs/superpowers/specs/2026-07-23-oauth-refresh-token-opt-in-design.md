# OAuth refresh token opt-in

**Date:** 2026-07-23  
**Branch / PR:** `fix/oauth-api-scope` (#3393)  
**Status:** Approved for planning

## Goal

Add refresh-token issuance to Sokosumi OAuth, **opt-in per client**, default off. Mirror the existing `sokosumi:api` opt-in across the full feature surface (utils, Core provider config, create/edit UI, list, consent, callback, tests).

## Non-goals

- Changing access-token lifetime (stays 2 hours) or refresh lifetime (stays 90 days once issued)
- Core `/v1` auth via refresh token alone (Core still requires `sokosumi:api` on AT + consent + client)
- Full authorize → refresh E2E in this PR
- Enabling anonymous DCR; authenticated create-client path only for UI

## Approach (chosen)

**Separate checkbox** — “Allow refresh tokens” — independent of “Allow Sokosumi API access”.

Alternatives rejected:

- Tie refresh to API access (forces RT on every API client; blocks identity+refresh)
- Provider-only support without client grant/scope sync (incomplete vs BA rules)

## Scope and grants model

| Layer | Default (no refresh) | Refresh opt-in |
|-------|----------------------|----------------|
| Provider `scopes` | `openid`, `sokosumi:api`, `offline_access` | same |
| Provider `grantTypes` | `authorization_code`, `refresh_token` | same |
| Client registration default scopes | `openid` only | unchanged |
| Client allowed scopes | `openid` ± `sokosumi:api` | + `offline_access` when checked |
| Client `grant_types` | `authorization_code` only | + `refresh_token` when checked |
| Token response | no refresh token unless authorize includes `offline_access` and client allows it | refresh token issued (~90d) |

Better Auth rules this design depends on:

- Refresh grant must be in provider `grantTypes` (today only `authorization_code` → RT grant rejected)
- Refresh token issued only when scopes include `offline_access` and client allows `refresh_token` grant
- Client allow-list must include `offline_access` for authorize to grant it

### Shared helpers (`@sokosumi/utils`)

- `OAUTH_SCOPE_OFFLINE_ACCESS = "offline_access"`
- Add to `OAUTH_PROVIDER_SCOPES`
- Keep `OAUTH_CLIENT_REGISTRATION_DEFAULT_SCOPES = ["openid"]`
- Change `buildOAuthClientScopeParam` to options object:

  ```ts
  buildOAuthClientScopeParam({
    includeCoreApi: boolean;
    includeOfflineAccess: boolean;
  }): string
  ```

- `hasOfflineAccessOAuthScope(scopes)`
- `buildOAuthClientGrantTypes(includeOfflineAccess: boolean): ("authorization_code" | "refresh_token")[]`

### Core `oauthProvider`

- `scopes: [...OAUTH_PROVIDER_SCOPES]` (includes `offline_access`)
- `grantTypes: ["authorization_code", "refresh_token"]`
- `clientRegistrationDefaultScopes` / `clientRegistrationAllowedScopes` stay aligned with provider scopes (allowed = full provider list; default = openid only)
- Lifetimes unchanged: AT 2h, RT 90d, ID 20h, code 10m
- **`verifyOAuthToken` unchanged** for refresh — still gates on `sokosumi:api` only

## Web UI

### Create / Edit

- Checkbox **Allow refresh tokens** (default off), independent of API checkbox
- Help copy: unchecked = no refresh; checked = client may request `offline_access` and receive refresh tokens that can obtain new access tokens later (up to ~90 days). Turning off removes `offline_access` from the client allow-list; users need reauthorize for new RTs.
- Edit initial value from `hasOfflineAccessOAuthScope(client.scope)`; on save, keep `grant_types` in sync with the checkbox (scope is source of truth for UI)

### Hooks / types

- `includeOfflineAccess?: boolean` on create/update requests
- Same omit semantics as API: if omitted on update, do not send `scope` / `grant_types` patches for that field pair when both API and refresh are omitted; when either boolean is provided, send full rebuilt `scope` and matching `grant_types` from both flags (edit dialog always sends both)

Clarified save behavior for edit (always sends both booleans from form):

- Always pass both `includeCoreApi` and `includeOfflineAccess` from the form
- Rebuild `scope` and `grant_types` from both flags every save

Create always sends both (defaults false).

### List

- Keep identity / API badge
- Add muted “Refresh” badge when offline access allowed

### Consent

When authorize `scope` includes `offline_access`, show:

> This app can stay signed in and get new access tokens later without asking you again (refresh tokens, up to 90 days).

Can appear alongside the API notice when both scopes are requested.

### Callback

If token response includes `refresh_token` (or scope includes `offline_access`), success warning should mention storing the refresh token securely and that it can obtain new access tokens. Keep existing identity vs API access-token warnings for AT semantics.

## Privilege reduction

Turning refresh **off** on edit:

1. Remove `offline_access` from client scopes (**this is the real gate**)
2. Set `grant_types` to `authorization_code` only (hygiene; not sufficient alone)

**Better Auth `@better-auth/oauth-provider@1.6.23` quirk:** `clientAllowsGrant` treats any client allowed for `authorization_code` as allowed for `refresh_token`. Dropping `refresh_token` from client `grant_types` alone does **not** stop refresh. Refresh fails when stored RT scopes (including `offline_access`) are no longer a subset of the client allow-list (`validateClientCredentials`). Keep syncing `grant_types` for hygiene; document privilege reduction as **scope allow-list** removal of `offline_access`.

Turning refresh **on**: users must reauthorize with `offline_access` to receive an RT.

## Testing

- Utils: all combinations of API × refresh for scope/grant helpers
- Hook tests: create/update with `includeOfflineAccess` true/false; create default omits RT
- Core middleware: existing `sokosumi:api` suite unchanged; optional assert that presence of `offline_access` without `sokosumi:api` still 401s Core
- Manual: create with refresh → authorize with `offline_access` → RT present; refresh grant returns new AT; disable refresh on client → refresh grant fails

## Locales

Add/update keys in all `apps/web/messages/*` for create/edit label+help, list badge, consent notice, callback warning variants as needed. `en.json` is source of truth; real translations in other locales.

## Rollout / breaking

- Existing clients: no refresh (unchanged behavior)
- Provider now advertises `offline_access` and supports `refresh_token` grant — only clients that opt in and authorize with that scope receive RTs
- Document in PR body: opt-in checkbox + authorize `scope=... offline_access`

## Implementation order (for plan)

1. Utils helpers + tests
2. Core `oauthProvider` grantTypes/scopes
3. Web types/utils/hooks + tests
4. Create/edit dialogs + list badge
5. Consent + callback copy
6. Locales
7. Manual checklist / PR description update
