# Remove Web Better Auth Handler (auth migration cutover)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for behavior changes; superpowers:verification-before-completion before PR.

**Goal:** Delete web's duplicate Better Auth runtime so only Core serves `/auth`. Web keeps session reads via `auth.server.ts` (Core HTTP) and browser client via `auth.client.ts` when `NEXT_PUBLIC_USE_CORE_AUTH_CLIENT=true`.

**Architecture:** Shared client-safe `Session` / `Account` / `SessionUser` types and Better Auth additional-field schema live in `@sokosumi/utils`. Web auth client plugins infer types from that schema instead of `typeof auth`. Organization preferred-org persistence calls Core directly from `organization/action.ts` (no web Prisma).

**Tech Stack:** Next.js 16 web, Hono Core (unchanged), `@sokosumi/utils`, Vitest, Biome.

---

### Task 1: Shared auth types in `@sokosumi/utils`

**Files:**
- Create: `packages/utils/src/better-auth-types.ts`
- Create: `packages/utils/src/better-auth-client-schema.ts`
- Create: `packages/utils/src/__tests__/better-auth-types.test.ts`
- Modify: `packages/utils/src/index.ts`

- [ ] **Step 1: Write failing test** — assert exported `Session`, `SessionUser`, `Account` shapes are usable (minimal structural test).
- [ ] **Step 2: Run** `pnpm --filter @sokosumi/utils test better-auth-types` — expect FAIL.
- [ ] **Step 3: Implement** client-safe interfaces matching Core Better Auth responses (no Prisma/server imports).
- [ ] **Step 4: Export** additional-field schema consts mirroring Core `auth.ts` user/org fields.
- [ ] **Step 5: Run test** — expect PASS.

---

### Task 2: OAuth callback Core issuer (TDD)

**Files:**
- Modify: `apps/web/src/app/(auth)/oauth/callback/page.tsx`
- Create: `apps/web/src/app/(auth)/oauth/callback/__tests__/oauth-callback-issuer.test.ts`

- [ ] **Step 1: Write failing test** — helper/build expected issuer from `getBrowserCoreAuthBaseUrl()` pattern, not `/api/auth`.
- [ ] **Step 2: Run** targeted vitest — expect FAIL.
- [ ] **Step 3: Update callback page** to use `getBrowserCoreAuthBaseUrl()` + `normalizeOAuthIssuerBase`.
- [ ] **Step 4: Run test** — expect PASS.

---

### Task 3: Auth client plugins without web `auth.ts`

**Files:**
- Modify: `apps/web/src/lib/auth/auth-client.plugins.ts`
- Modify: `apps/web/src/lib/auth/__tests__/auth.client.test.ts`

- [ ] **Step 1: Remove** `import type { auth } from "./auth"`.
- [ ] **Step 2: Use** `@sokosumi/utils` schema type for `inferAdditionalFields` / `inferOrgAdditionalFields` (or explicit org schema if inference needs a phantom Auth type).
- [ ] **Step 3: Update tests** — remove `@/lib/auth/auth` mock; default `NEXT_PUBLIC_USE_CORE_AUTH_CLIENT` expectations to `true` where relevant.
- [ ] **Step 4: Run** `pnpm --filter web test auth.client.test.ts` — expect PASS.

---

### Task 4: Migrate type imports across web

**Files:**
- Modify: all files importing types from `@/lib/auth/auth` (~25 files)
- Modify: `apps/web/src/lib/auth/auth.server.ts` — import/re-export from `@sokosumi/utils`

- [ ] **Step 1: Replace** `import type { Session, Account, SessionUser } from "@/lib/auth/auth"` with `@sokosumi/utils`.
- [ ] **Step 2: Re-export** types from `auth.server.ts` for `getSession` consumers if needed.
- [ ] **Step 3: Fix** test mocks that referenced `@/lib/auth/auth`.

---

### Task 5: Preferred organization — drop web Prisma service

**Files:**
- Modify: `apps/web/src/lib/actions/organization/action.ts`
- Modify: `apps/web/src/lib/actions/organization/__tests__/action.test.ts`
- Delete: `apps/web/src/lib/services/preferred-organization.service.ts`
- Delete: `apps/web/src/lib/services/__tests__/preferred-organization.service.test.ts`
- Modify: `apps/web/src/lib/services/index.ts`

- [ ] **Step 1: Inline** `coreClient.setMyPreferredOrganization` + `CORE_API_ERROR_KINDS` handling in `updatePreferredOrganization` action.
- [ ] **Step 2: Update** organization action tests (mock `coreClient.setMyPreferredOrganization`).
- [ ] **Step 3: Delete** web preferred-organization service + tests + barrel export.

---

### Task 6: Delete duplicate web auth runtime

**Files:**
- Delete: `apps/web/src/app/api/auth/[...all]/route.ts`
- Delete: `apps/web/src/lib/auth/auth.ts`
- Delete: `apps/web/src/lib/auth/__tests__/auth.test.ts`

- [ ] **Step 1: Grep** — confirm no runtime `auth` imports remain (only removed mocks).
- [ ] **Step 2: Delete** files above.
- [ ] **Step 3: Run** `pnpm --filter web test` — fix any breakage.

---

### Task 7: Default Core auth client flag

**Files:**
- Modify: `apps/web/src/config/env.public.ts`
- Modify: `apps/web/.env.example`
- Modify: `apps/web/src/lib/auth/auth.client.ts` — simplify if false branch is dead

- [ ] **Step 1: Set** `NEXT_PUBLIC_USE_CORE_AUTH_CLIENT` default to `true` in schema + `.env.example`.
- [ ] **Step 2: Keep** `auth.client.ts` conditional for env override safety; no large refactor.

---

### Task 8: Verification + draft PR

- [ ] **Step 1:** `pnpm --filter @sokosumi/utils test`
- [ ] **Step 2:** `pnpm --filter web test`
- [ ] **Step 3:** `pnpm web:check`
- [ ] **Step 4:** Commit on `feat-remove-web-auth-handler`, push, `gh pr create --draft`

**Follow-ups (out of scope):** web `stripe.service.ts` / `organization-subscription.service.ts` Prisma usage; remove `BETTER_AUTH_*` web env vars after ops cutover.
