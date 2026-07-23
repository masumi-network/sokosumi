# OAuth Refresh Token Opt-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-client opt-in for OAuth refresh tokens (`offline_access` + `refresh_token` grant), default off, across utils, Core provider, and web create/edit/list/consent/callback.

**Architecture:** Extend shared `@sokosumi/utils` OAuth helpers; enable provider-level `refresh_token` grant and advertise `offline_access`; client registration/update checkbox rebuilds `scope` + `grant_types` together. Core `/v1` gate stays `sokosumi:api`-only.

**Tech Stack:** TypeScript, Better Auth `@better-auth/oauth-provider`, Vitest, next-intl, React Hook Form + Zod (existing OAuth client dialogs).

**Spec:** `docs/superpowers/specs/2026-07-23-oauth-refresh-token-opt-in-design.md`

## Global Constraints

- Default clients: no refresh (`openid` only; `grant_types: ["authorization_code"]`)
- Refresh opt-in independent of `sokosumi:api`
- Do not change AT (2h) / RT (90d) / ID (20h) / code (10m) lifetimes
- Do not add Core-side refresh-token bearer validation
- Pin no new deps; follow Biome + existing OAuth client UI patterns
- Update all locale files when adding keys (`en.json` source of truth + real translations)
- Branch: `fix/oauth-api-scope` (PR #3393)

## File map

| File | Responsibility |
|------|----------------|
| `packages/utils/src/oauth-scopes.ts` | Scope/grant helpers + constants |
| `packages/utils/src/__tests__/oauth-scopes.test.ts` | Unit tests for helpers |
| `packages/utils/src/index.ts` | Public exports |
| `apps/core/src/lib/auth.ts` | Provider `scopes` + `grantTypes` |
| `apps/web/.../oauth-clients/types.ts` | Form/request types |
| `apps/web/.../oauth-clients/utils.ts` | Default form values + zod |
| `apps/web/.../oauth-clients/hooks/use-oauth-clients.ts` | create/update payloads |
| `apps/web/.../oauth-clients/hooks/__tests__/use-oauth-clients.test.ts` | Hook tests |
| `apps/web/.../oauth-clients/create-oauth-client-dialog.tsx` | Create checkbox |
| `apps/web/.../oauth-clients/edit-oauth-client-dialog.tsx` | Edit checkbox |
| `apps/web/.../oauth-clients/oauth-clients-list.tsx` | Refresh badge |
| `apps/web/.../oauth/consent/page.tsx` | Offline consent notice |
| `apps/web/.../oauth/callback/page.tsx` | Refresh warning copy |
| `apps/web/messages/*.json` | All locale strings |
| `apps/core/src/middleware/auth.test.ts` | Optional: offline without API still 401 |

---

### Task 1: Utils — offline_access helpers (TDD)

**Files:**
- Modify: `packages/utils/src/oauth-scopes.ts`
- Modify: `packages/utils/src/__tests__/oauth-scopes.test.ts`
- Modify: `packages/utils/src/index.ts`

**Interfaces:**
- Consumes: existing `normalizeOAuthScopes` (private)
- Produces:
  - `OAUTH_SCOPE_OFFLINE_ACCESS: "offline_access"`
  - `OAUTH_PROVIDER_SCOPES` includes offline
  - `buildOAuthClientScopeParam(options: { includeCoreApi: boolean; includeOfflineAccess: boolean }): string`
  - `hasOfflineAccessOAuthScope(scopes): boolean`
  - `buildOAuthClientGrantTypes(includeOfflineAccess: boolean): Array<"authorization_code" | "refresh_token">`

- [ ] **Step 1: Write failing tests**

Replace/extend `packages/utils/src/__tests__/oauth-scopes.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  buildOAuthClientGrantTypes,
  buildOAuthClientScopeParam,
  hasCoreApiOAuthScope,
  hasOfflineAccessOAuthScope,
  OAUTH_CLIENT_REGISTRATION_DEFAULT_SCOPES,
  OAUTH_PROVIDER_SCOPES,
  OAUTH_SCOPE_CORE_API,
  OAUTH_SCOPE_OFFLINE_ACCESS,
  OAUTH_SCOPE_OPENID,
} from "../oauth-scopes";

describe("oauth scopes", () => {
  it("exports provider scopes including offline_access", () => {
    expect(OAUTH_SCOPE_OPENID).toBe("openid");
    expect(OAUTH_SCOPE_CORE_API).toBe("sokosumi:api");
    expect(OAUTH_SCOPE_OFFLINE_ACCESS).toBe("offline_access");
    expect(OAUTH_PROVIDER_SCOPES).toEqual([
      "openid",
      "sokosumi:api",
      "offline_access",
    ]);
    expect(OAUTH_CLIENT_REGISTRATION_DEFAULT_SCOPES).toEqual(["openid"]);
  });

  it("builds scope params from API and offline flags", () => {
    expect(
      buildOAuthClientScopeParam({
        includeCoreApi: false,
        includeOfflineAccess: false,
      }),
    ).toBe("openid");
    expect(
      buildOAuthClientScopeParam({
        includeCoreApi: true,
        includeOfflineAccess: false,
      }),
    ).toBe("openid sokosumi:api");
    expect(
      buildOAuthClientScopeParam({
        includeCoreApi: false,
        includeOfflineAccess: true,
      }),
    ).toBe("openid offline_access");
    expect(
      buildOAuthClientScopeParam({
        includeCoreApi: true,
        includeOfflineAccess: true,
      }),
    ).toBe("openid sokosumi:api offline_access");
  });

  it("builds grant_types from offline flag", () => {
    expect(buildOAuthClientGrantTypes(false)).toEqual(["authorization_code"]);
    expect(buildOAuthClientGrantTypes(true)).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
  });

  it("detects Core API and offline scopes", () => {
    expect(hasCoreApiOAuthScope(["openid", "offline_access"])).toBe(false);
    expect(hasOfflineAccessOAuthScope(["openid"])).toBe(false);
    expect(hasOfflineAccessOAuthScope(["openid", "offline_access"])).toBe(true);
    expect(hasOfflineAccessOAuthScope("openid offline_access")).toBe(true);
    expect(hasOfflineAccessOAuthScope(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @sokosumi/utils test src/__tests__/oauth-scopes.test.ts`  
Expected: FAIL (missing exports / wrong `buildOAuthClientScopeParam` signature)

- [ ] **Step 3: Implement helpers**

Update `packages/utils/src/oauth-scopes.ts` to:

```typescript
/**
 * OAuth scopes used by Sokosumi's Better Auth oauthProvider.
 *
 * - `openid` — OIDC identity only (ID token / userinfo)
 * - `sokosumi:api` — delegated Core `/v1` API access as the consenting user
 * - `offline_access` — refresh tokens (new access tokens without re-consent)
 */
export const OAUTH_SCOPE_OPENID = "openid";
export const OAUTH_SCOPE_CORE_API = "sokosumi:api";
export const OAUTH_SCOPE_OFFLINE_ACCESS = "offline_access";

// NOTE: Do not add OAUTH_CORE_API_SCOPE_PARAM — unused; use
// buildOAuthClientScopeParam({ includeCoreApi: true, includeOfflineAccess: false }).

/** Scopes advertised by the OAuth provider (authorization server). */
export const OAUTH_PROVIDER_SCOPES = [
  OAUTH_SCOPE_OPENID,
  OAUTH_SCOPE_CORE_API,
  OAUTH_SCOPE_OFFLINE_ACCESS,
] as const;

export const OAUTH_CLIENT_REGISTRATION_DEFAULT_SCOPES = [
  OAUTH_SCOPE_OPENID,
] as const;

export interface BuildOAuthClientScopeParamOptions {
  includeCoreApi: boolean;
  includeOfflineAccess: boolean;
}

/** Build the space-separated scope string for client registration / update. */
export function buildOAuthClientScopeParam(
  options: BuildOAuthClientScopeParamOptions,
): string {
  const scopes = [OAUTH_SCOPE_OPENID];
  if (options.includeCoreApi) {
    scopes.push(OAUTH_SCOPE_CORE_API);
  }
  if (options.includeOfflineAccess) {
    scopes.push(OAUTH_SCOPE_OFFLINE_ACCESS);
  }
  return scopes.join(" ");
}

export type OAuthClientGrantType = "authorization_code" | "refresh_token";

export function buildOAuthClientGrantTypes(
  includeOfflineAccess: boolean,
): OAuthClientGrantType[] {
  if (includeOfflineAccess) {
    return ["authorization_code", "refresh_token"];
  }
  return ["authorization_code"];
}

function normalizeOAuthScopes(
  scopes: readonly string[] | string | null | undefined,
): string[] {
  if (!scopes) {
    return [];
  }

  const entries = typeof scopes === "string" ? [scopes] : scopes;

  return entries.flatMap((entry) =>
    entry.split(/\s+/).filter((scope) => scope.length > 0),
  );
}

export function hasCoreApiOAuthScope(
  scopes: readonly string[] | string | null | undefined,
): boolean {
  return normalizeOAuthScopes(scopes).includes(OAUTH_SCOPE_CORE_API);
}

export function hasOfflineAccessOAuthScope(
  scopes: readonly string[] | string | null | undefined,
): boolean {
  return normalizeOAuthScopes(scopes).includes(OAUTH_SCOPE_OFFLINE_ACCESS);
}
```

Export new symbols from `packages/utils/src/index.ts` (add to existing oauth-scopes export block):

```typescript
export {
  buildOAuthClientGrantTypes,
  buildOAuthClientScopeParam,
  hasCoreApiOAuthScope,
  hasOfflineAccessOAuthScope,
  OAUTH_CLIENT_REGISTRATION_DEFAULT_SCOPES,
  OAUTH_PROVIDER_SCOPES,
  OAUTH_SCOPE_CORE_API,
  OAUTH_SCOPE_OFFLINE_ACCESS,
  OAUTH_SCOPE_OPENID,
  type BuildOAuthClientScopeParamOptions,
  type OAuthClientGrantType,
} from "./oauth-scopes.js";
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @sokosumi/utils test src/__tests__/oauth-scopes.test.ts && pnpm --filter @sokosumi/utils build`  
Expected: PASS + dist rebuilt

- [ ] **Step 5: Commit**

```bash
git add packages/utils/src/oauth-scopes.ts packages/utils/src/__tests__/oauth-scopes.test.ts packages/utils/src/index.ts
git commit -m "feat(utils): add offline_access OAuth scope and grant helpers"
```

---

### Task 2: Core provider — enable refresh grant + advertise offline_access

**Files:**
- Modify: `apps/core/src/lib/auth.ts` (oauthProvider block ~703–715)
- Modify: `apps/core/src/middleware/auth.test.ts` (optional one case)

**Interfaces:**
- Consumes: `OAUTH_PROVIDER_SCOPES` (now includes offline)
- Produces: provider accepts `grant_type=refresh_token`; metadata advertises `offline_access`

- [ ] **Step 1: Update oauthProvider config**

In `apps/core/src/lib/auth.ts`, set:

```typescript
scopes: [...OAUTH_PROVIDER_SCOPES],
clientRegistrationDefaultScopes: [
  ...OAUTH_CLIENT_REGISTRATION_DEFAULT_SCOPES,
],
clientRegistrationAllowedScopes: [...OAUTH_PROVIDER_SCOPES],
grantTypes: ["authorization_code", "refresh_token"],
```

Leave lifetime fields unchanged.

- [ ] **Step 2: Optional middleware regression test**

In `apps/core/src/middleware/auth.test.ts`, add a case: AT scopes `["openid", "offline_access"]` (no `sokosumi:api`) → 401, consent not required to be called after AT scope fail (same as openid-only).

```typescript
it("returns 401 for OAuth tokens that only have openid and offline_access", async () => {
  oauthAccessTokenFindUniqueMock.mockResolvedValue({
    token: "hashed_token",
    expiresAt: new Date(Date.now() + 60_000),
    userId: "user_oauth",
    refreshId: null,
    refreshToken: null,
    clientId: "client_123",
    scopes: ["openid", "offline_access"],
    user: { role: "user" },
    client: {
      disabled: false,
      scopes: ["openid", "offline_access", "sokosumi:api"],
    },
  });

  const app = createApp();
  const response = await app.request("http://localhost/", {
    headers: { authorization: "Bearer oauth_offline_only" },
  });

  expect(response.status).toBe(401);
  expect(oauthConsentFindFirstMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter core test src/middleware/auth.test.ts && pnpm --filter core typecheck`  
Expected: PASS (web typecheck may fail until Task 3 updates call sites — OK if only utils signature errors in web; fix in Task 3 before claiming green monorepo)

If `pnpm typecheck` at root fails on web `buildOAuthClientScopeParam` arity, proceed immediately to Task 3 in same session before committing Task 2 alone — or commit Task 2 with note and fix in Task 3. Prefer **one commit after Tasks 2+3 compile**, or Task 2 commit only `auth.ts` + core test if web still broken briefly is unacceptable under husky (husky runs full typecheck). **Must update web call sites in same commit as utils signature break if husky blocks.**

**Practical commit strategy:** Because Task 1 changes `buildOAuthClientScopeParam` signature, either:
- Commit Task 1 only after updating web call sites to temporary wrappers, OR
- Do Task 1 + Task 3 hook/utils call-site updates before husky commit, with Task 2 in between for auth.ts.

**Recommended:** After Task 1 implementation, immediately patch web call sites in Task 3 Steps 1–4 enough to typecheck, then commit Task 1+3 utils/web together if needed. Cleaner: **Task 1 commit with `--no-verify` is forbidden by repo norms** — so update all `buildOAuthClientScopeParam` call sites in Task 1 Step 3 before commit:

Call sites today:
- `apps/web/.../hooks/use-oauth-clients.ts` (2)
- Any other `rg buildOAuthClientScopeParam`

Minimal bridge in Task 1 Step 3 if deferring UI: pass `{ includeCoreApi: x, includeOfflineAccess: false }` at existing call sites so typecheck passes, then Task 3 adds the real flag.

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/lib/auth.ts apps/core/src/middleware/auth.test.ts
# include any temporary call-site arity fixes if committed with Task 1 already
git commit -m "feat(auth): enable OAuth refresh_token grant and offline_access scope"
```

---

### Task 3: Web types, form utils, hooks (TDD)

**Files:**
- Modify: `apps/web/src/app/(app)/developer/components/oauth-clients/types.ts`
- Modify: `apps/web/src/app/(app)/developer/components/oauth-clients/utils.ts`
- Modify: `apps/web/src/app/(app)/developer/components/oauth-clients/hooks/use-oauth-clients.ts`
- Modify: `apps/web/src/app/(app)/developer/components/oauth-clients/hooks/__tests__/use-oauth-clients.test.ts`
- Modify: `apps/web/src/app/(app)/developer/components/oauth-clients/__tests__/utils.test.ts` (if defaults asserted)

**Interfaces:**
- Consumes: `buildOAuthClientScopeParam`, `buildOAuthClientGrantTypes`
- Produces: create/update send `scope` + `grant_types` from both flags

- [ ] **Step 1: Write failing hook tests**

Add/adjust in `use-oauth-clients.test.ts`:

```typescript
it("registers offline_access and refresh_token grant when includeOfflineAccess is true", async () => {
  createClientMock.mockResolvedValue({
    data: {
      client_id: "client_rt",
      client_secret: "secret",
      client_name: "RT Client",
      redirect_uris: ["https://example.com/cb"],
      scope: "openid offline_access",
      grant_types: ["authorization_code", "refresh_token"],
    },
    error: null,
  });

  const { result } = renderHook(() => useOAuthClients());
  await waitFor(() => {
    expect(result.current.isInitialLoading).toBe(false);
  });

  await act(async () => {
    await result.current.create({
      name: "RT Client",
      redirectUris: ["https://example.com/cb"],
      includeCoreApi: false,
      includeOfflineAccess: true,
    });
  });

  expect(createClientMock).toHaveBeenCalledWith({
    client_name: "RT Client",
    redirect_uris: ["https://example.com/cb"],
    scope: "openid offline_access",
    grant_types: ["authorization_code", "refresh_token"],
  });
});

it("updates a client to disable refresh when includeOfflineAccess is false", async () => {
  updateClientMock.mockResolvedValue({
    data: {
      client_id: "client_1",
      client_name: "Client",
      redirect_uris: ["https://example.com/cb"],
      scope: "openid",
      grant_types: ["authorization_code"],
    },
    error: null,
  });

  const { result } = renderHook(() => useOAuthClients());
  await waitFor(() => {
    expect(result.current.isInitialLoading).toBe(false);
  });

  await act(async () => {
    await result.current.update({
      clientId: "client_1",
      name: "Client",
      redirectUris: ["https://example.com/cb"],
      includeCoreApi: false,
      includeOfflineAccess: false,
    });
  });

  expect(updateClientMock).toHaveBeenCalledWith({
    client_id: "client_1",
    update: {
      client_name: "Client",
      redirect_uris: ["https://example.com/cb"],
      scope: "openid",
      grant_types: ["authorization_code"],
    },
  });
});
```

Update existing create/update tests that call `buildOAuthClientScopeParam` expectations: default create must send `grant_types: ["authorization_code"]` and scope options object form; API-only create → `scope: "openid sokosumi:api"`, `grant_types: ["authorization_code"]`.

Update omit-both test: when neither flag passed, still no `scope`/`grant_types` in update.

- [ ] **Step 2: Run hook tests — expect FAIL**

Run: `pnpm --filter web test 'src/app/(app)/developer/components/oauth-clients/hooks/__tests__/use-oauth-clients.test.ts'`  
Expected: FAIL

- [ ] **Step 3: Update types + utils defaults/schema**

`types.ts` — add `includeOfflineAccess: boolean` to create/edit form data; `includeOfflineAccess?: boolean` on create/update requests (create form always supplies it).

`utils.ts`:

```typescript
export const DEFAULT_CREATE_FORM_VALUES = {
  name: "",
  redirectUris: "",
  includeCoreApi: false,
  includeOfflineAccess: false,
};

export const DEFAULT_EDIT_FORM_VALUES = {
  name: "",
  redirectUris: "",
  includeCoreApi: false,
  includeOfflineAccess: false,
};

// in createOAuthClientSchema:
includeCoreApi: z.boolean(),
includeOfflineAccess: z.boolean(),
```

- [ ] **Step 4: Implement hook payloads**

```typescript
import {
  buildOAuthClientGrantTypes,
  buildOAuthClientScopeParam,
} from "@sokosumi/utils";

// create:
const includeCoreApi = data.includeCoreApi ?? false;
const includeOfflineAccess = data.includeOfflineAccess ?? false;
const result = await authClient.oauth2.createClient({
  redirect_uris: data.redirectUris,
  client_name: data.name,
  scope: buildOAuthClientScopeParam({ includeCoreApi, includeOfflineAccess }),
  grant_types: buildOAuthClientGrantTypes(includeOfflineAccess),
});

// update:
const hasScopeFlags =
  typeof data.includeCoreApi === "boolean" ||
  typeof data.includeOfflineAccess === "boolean";

const result = await authClient.oauth2.updateClient({
  client_id: data.clientId,
  update: {
    client_name: data.name,
    redirect_uris: data.redirectUris,
    ...(hasScopeFlags
      ? {
          scope: buildOAuthClientScopeParam({
            includeCoreApi: data.includeCoreApi ?? false,
            includeOfflineAccess: data.includeOfflineAccess ?? false,
          }),
          grant_types: buildOAuthClientGrantTypes(
            data.includeOfflineAccess ?? false,
          ),
        }
      : {}),
  },
});
```

Spec note: if either flag passed, both should be passed from UI. Using `?? false` for a missing sibling is acceptable for defensive hook behavior; dialogs always send both.

- [ ] **Step 5: Run tests — expect PASS**

Run:  
`pnpm --filter web test 'src/app/(app)/developer/components/oauth-clients/hooks/__tests__/use-oauth-clients.test.ts' src/app/\(app\)/developer/components/oauth-clients/__tests__/utils.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(app\)/developer/components/oauth-clients/types.ts \
  apps/web/src/app/\(app\)/developer/components/oauth-clients/utils.ts \
  apps/web/src/app/\(app\)/developer/components/oauth-clients/hooks/use-oauth-clients.ts \
  apps/web/src/app/\(app\)/developer/components/oauth-clients/hooks/__tests__/use-oauth-clients.test.ts \
  apps/web/src/app/\(app\)/developer/components/oauth-clients/__tests__/utils.test.ts
git commit -m "feat(web): wire OAuth client create/update for refresh opt-in"
```

---

### Task 4: Create / Edit dialogs + list badge

**Files:**
- Modify: `create-oauth-client-dialog.tsx`
- Modify: `edit-oauth-client-dialog.tsx`
- Modify: `oauth-clients-list.tsx`
- Modify: `apps/web/messages/*.json` (keys used here — can land with Task 6; if compile needs keys at runtime only, add en stubs in this task)

- [ ] **Step 1: Create dialog**

Mirror API checkbox for `includeOfflineAccess`:
- FormField name `includeOfflineAccess`
- Labels: `CreateDialog.includeOfflineAccessLabel` / `includeOfflineAccessHelp`
- Submit payload includes `includeOfflineAccess: values.includeOfflineAccess`

- [ ] **Step 2: Edit dialog**

- Import `hasOfflineAccessOAuthScope`
- Reset: `includeOfflineAccess: hasOfflineAccessOAuthScope(client.scope)`
- Submit: pass both `includeCoreApi` and `includeOfflineAccess`
- Same checkbox UI with `EditDialog.*` keys

- [ ] **Step 3: List badge**

```tsx
import { hasCoreApiOAuthScope, hasOfflineAccessOAuthScope } from "@sokosumi/utils";

const allowsOfflineAccess = hasOfflineAccessOAuthScope(client.scope);

// after API/identity badge:
{allowsOfflineAccess ? (
  <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
    {t("Status.refresh")}
  </span>
) : null}
```

Keep identity vs API badge as today.

- [ ] **Step 4: Commit** (after locale keys exist — if keys missing, do Task 6 en keys first in same commit)

```bash
git commit -m "feat(web): add OAuth refresh opt-in checkbox and list badge"
```

---

### Task 5: Consent + callback copy

**Files:**
- Modify: `apps/web/src/app/(auth)/oauth/consent/page.tsx`
- Modify: `apps/web/src/app/(auth)/oauth/callback/page.tsx`
- Modify: messages (with Task 6)

- [ ] **Step 1: Consent**

```typescript
import {
  hasCoreApiOAuthScope,
  hasOfflineAccessOAuthScope,
} from "@sokosumi/utils";

const requestsCoreApi = hasCoreApiOAuthScope(oauthSearchParams.get("scope"));
const requestsOfflineAccess = hasOfflineAccessOAuthScope(
  oauthSearchParams.get("scope"),
);

// In JSX, after api notice:
{requestsOfflineAccess ? (
  <p className="text-muted-foreground mt-2 text-sm">
    {t("offlineAccessNotice")}
  </p>
) : null}
```

Optional: if both API and offline, prefer a description that stays identity/API based as today; notices stack.

- [ ] **Step 2: Callback**

Keep AT warning branch (`warningApi` / `warningIdentity`). Additionally when `tokenResponse.refresh_token` or `hasOfflineAccessOAuthScope(tokenResponse.scope)`:

```tsx
{(tokenResponse.refresh_token ||
  hasOfflineAccessOAuthScope(tokenResponse.scope)) && (
  <p className="text-muted-foreground text-sm">
    {t("success.warningRefresh")}
  </p>
)}
```

Place inside the existing muted warning box or as a second paragraph in that box.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): show OAuth offline_access consent and callback warnings"
```

---

### Task 6: Locales (all catalogs)

**Files:** `apps/web/messages/{en,de,es,fr,it,ja,pt,pt-BR,zh-Hans}.json`

**Keys to add:**

Under `App.Account.OAuthClients`:
- `CreateDialog.includeOfflineAccessLabel`
- `CreateDialog.includeOfflineAccessHelp`
- `EditDialog.includeOfflineAccessLabel`
- `EditDialog.includeOfflineAccessHelp`
- `Status.refresh`

Under `App.Account.OAuthConsent`:
- `offlineAccessNotice`

Under `App.Account.OAuthCallback.success`:
- `warningRefresh`

**English copy (source of truth):**

```json
"includeOfflineAccessLabel": "Allow refresh tokens",
"includeOfflineAccessHelp": "Unchecked (default): no refresh tokens. Checked: client may request offline_access and receive refresh tokens that can obtain new access tokens later (up to about 90 days). Turning this off updates the client's allow-list and grants; users must reauthorize for new refresh tokens.",
```

Edit help can drop “(default)” and mention privilege reduction similarly.

```json
"Status": {
  "disabled": "Disabled",
  "apiAccess": "API access",
  "identityOnly": "Identity only",
  "refresh": "Refresh"
}
```

```json
"offlineAccessNotice": "This app can stay signed in and get new access tokens later without asking you again (refresh tokens, up to 90 days)."
```

```json
"warningRefresh": "Store the refresh token securely. It can be used to obtain new access tokens without repeating consent until it expires or is revoked."
```

Translate properly in non-en locales (not English placeholders).

- [ ] **Step 1: Apply keys to all locale files**
- [ ] **Step 2: Commit**

```bash
git add apps/web/messages/*.json
git commit -m "feat(i18n): add OAuth refresh token opt-in strings"
```

(If Tasks 4–5 need keys earlier, merge this commit with those.)

---

### Task 7: Verify + PR description note

- [ ] **Step 1: Run targeted tests**

```bash
pnpm --filter @sokosumi/utils test src/__tests__/oauth-scopes.test.ts
pnpm --filter core test src/middleware/auth.test.ts
pnpm --filter web test 'src/app/(app)/developer/components/oauth-clients/hooks/__tests__/use-oauth-clients.test.ts'
pnpm --filter web test 'src/app/(app)/developer/components/oauth-clients/__tests__/utils.test.ts'
pnpm check && pnpm typecheck
```

Expected: all green

- [ ] **Step 2: Manual checklist (document in PR body for human)**

- Create client default → no `offline_access`, grant_types auth code only
- Create with refresh → authorize `openid offline_access` → `refresh_token` in token response
- `POST /auth/oauth2/token` with `grant_type=refresh_token` → new AT
- Edit disable refresh → refresh grant fails
- API-only client still works without refresh
- Identity + refresh without API → userinfo OK, Core `/v1` 401

- [ ] **Step 3: Provide updated PR description snippet** (human pastes) covering refresh opt-in + authorize `offline_access`

- [ ] **Step 4: Push branch**

```bash
git push -u origin fix/oauth-api-scope
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| `offline_access` constant + provider scopes | 1–2 |
| `buildOAuthClientScopeParam` options object | 1, 3 |
| `buildOAuthClientGrantTypes` | 1, 3 |
| Provider `grantTypes` includes `refresh_token` | 2 |
| Create/edit checkbox default off | 4, 6 |
| Hooks send scope + grant_types | 3 |
| Omit both flags → no scope/grant patch | 3 |
| List refresh badge | 4 |
| Consent offline notice (access renew wording) | 5, 6 |
| Callback refresh warning | 5, 6 |
| Core gate unchanged / offline≠API | 2 |
| Locales all catalogs | 6 |
| Manual + PR note | 7 |

## Placeholder scan

No TBD/TODO left in task steps. Commit strategy for Task 1 signature break called out explicitly.
