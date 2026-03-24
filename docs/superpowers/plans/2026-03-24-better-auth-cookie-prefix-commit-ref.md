# Better Auth Cookie Prefix Commit Ref Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make preview Better Auth cookie prefixes derive from `VERCEL_GIT_COMMIT_REF`, with `sokosumi-preview` as the only preview fallback.

**Architecture:** Keep production and preprod host-based prefixes unchanged, but collapse preview identity to a single branch-first rule in the shared utils resolver. Thread the new Vercel commit-ref env through web, core, proxy, and client cookie-name lookups so every consumer computes the same prefix.

**Tech Stack:** TypeScript, Better Auth, Next.js, Hono, Vitest, pnpm workspace

---

### Task 1: Shared Resolver Tests

**Files:**
- Modify: `packages/utils/src/__tests__/better-auth-cookie-prefix.test.ts`

- [ ] Step 1: Add failing tests for preview commit-ref precedence and generic preview fallback.
- [ ] Step 2: Run `pnpm test src/__tests__/better-auth-cookie-prefix.test.ts` in `packages/utils` and confirm the new cases fail.
- [ ] Step 3: Keep prod and preprod assertions unchanged to protect current behavior.

### Task 2: Shared Resolver Simplification

**Files:**
- Modify: `packages/utils/src/better-auth-cookie-prefix.ts`
- Modify: `packages/utils/src/index.ts` if export shape changes

- [ ] Step 1: Extend resolver params with `vercelEnv` and `vercelGitCommitRef`.
- [ ] Step 2: Delete preview host and branch-url parsing that is no longer needed.
- [ ] Step 3: Implement the minimal rule set:
  prod => `sokosumi`
  preprod => `sokosumi-preprod`
  preview + commit ref => `sokosumi-preview-<sanitized-branch>`
  preview without commit ref => `sokosumi-preview`
- [ ] Step 4: Re-run `pnpm test src/__tests__/better-auth-cookie-prefix.test.ts` in `packages/utils`.

### Task 3: Environment Plumbing

**Files:**
- Modify: `apps/web/src/config/env.secrets.ts`
- Modify: `apps/web/src/config/env.public.ts`
- Modify: `apps/web/next.config.ts`
- Modify: `apps/core/src/config/env.ts`

- [ ] Step 1: Add `VERCEL_GIT_COMMIT_REF` to web server env validation.
- [ ] Step 2: Expose `NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF` from `next.config.ts`.
- [ ] Step 3: Add that public env to the web public config schema.
- [ ] Step 4: Add `VERCEL_GIT_COMMIT_REF` to core env validation.
- [ ] Step 5: Keep existing `VERCEL_BRANCH_URL` support for public base URL resolution, but stop using it for cookie prefix resolution.

### Task 4: Resolver Call Sites

**Files:**
- Modify: `apps/web/src/lib/auth/auth.ts`
- Modify: `apps/core/src/lib/auth.ts`
- Modify: `apps/web/src/proxy.ts`
- Modify: `apps/web/src/app/(auth)/signin/page.tsx`
- Modify: `apps/web/src/app/(auth)/signup/page.tsx`
- Modify: `apps/web/src/lib/auth/auth.client.ts`

- [ ] Step 1: Pass `vercelEnv` and `vercelGitCommitRef` to the shared resolver in web auth.
- [ ] Step 2: Pass the same values in core auth.
- [ ] Step 3: Update proxy cookie lookup to use the same inputs.
- [ ] Step 4: Update sign-in and sign-up page cookie-name reads.
- [ ] Step 5: Update browser-side auth client cookie-name resolution to use the public commit-ref env.

### Task 5: App Tests

**Files:**
- Modify: `apps/web/src/lib/auth/__tests__/auth.test.ts`
- Modify: `apps/web/src/lib/auth/__tests__/auth.client.test.ts`
- Modify: `apps/web/src/__tests__/proxy.test.ts`
- Modify: `apps/core/src/lib/auth.test.ts`

- [ ] Step 1: Update web auth tests to assert commit-ref-based preview prefixes.
- [ ] Step 2: Update core auth tests to assert the same preview rule.
- [ ] Step 3: Update proxy regression coverage so preview commit ref wins over hostname.
- [ ] Step 4: Add or update auth client coverage for browser cookie-name resolution.
- [ ] Step 5: Run targeted test files in `apps/web` and `apps/core`.

### Task 6: Verification

**Files:**
- No source changes expected

- [ ] Step 1: Run `pnpm --filter @sokosumi/utils build`.
- [ ] Step 2: Run targeted eslint for touched files in `packages/utils`, `apps/web`, and `apps/core`.
- [ ] Step 3: Review diff for leftover preview-host parsing and remove dead code if any remains.
- [ ] Step 4: Commit with a conventional commit message.
