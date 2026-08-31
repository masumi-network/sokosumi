# Soko Bot Version Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin Web workflow for listing, authoring, testing, inspecting, promoting, and archiving Soko Bot versions.

**Architecture:** Server Components load version catalog, gateway models, quality, and lab history through Web services backed by the generated Core client. Small Client Components own form controls, confirmations, mutation feedback, and `nuqs` URL state. Built-in versions remain visibly read-only and duplication creates authored drafts with every editable field copied except the slug.

**Tech Stack:** Next.js App Router, React 19, TypeScript, next-intl, nuqs, shadcn/Radix, Zod, neverthrow, Vitest, Testing Library, Biome

**Spec:** `docs/superpowers/specs/2026-08-27-soko-bot-version-authoring-design.md`

## Global Constraints

- Core owns all database access; Web uses only the generated Core client through its wrapper and service layers.
- Never hand-edit files under `apps/web/src/lib/clients/generated/`.
- Prefer Server Components; limit client code to interactive controls and URL state.
- Use `nuqs` for URL search state.
- Add all new product copy to English, German, and Spanish message catalogs.
- Use semantic colors and shadcn primitives; do not add dependencies.
- Preserve unrelated worktree changes.
- Run every required verification with `ulimit -n 65536` under Node 24, then make one local Conventional Commit. Do not push or deploy.

---

### Task 1: Core-client wrapper, service, and action boundary

**Files:**
- Modify: `apps/web/src/lib/clients/core.shared.ts`
- Modify: `apps/web/src/lib/services/admin-soko-bot.service.ts`
- Modify: `apps/web/src/lib/actions/admin-soko-bots/action.ts`
- Modify: `apps/web/src/lib/services/__tests__/admin-soko-bot.service.test.ts`
- Modify: `apps/web/src/lib/actions/admin-soko-bots/__tests__/action.test.ts`

**Interfaces:**
- Consumes: generated `SokoBotVersionList`, `SokoBotVersionDetail`, `SokoBotVersionWrite`, and `SokoBotGatewayModelList` DTOs.
- Produces: service methods `listVersions()`, `listGatewayModels()`, `createVersion(input)`, `updateVersion(slug, input)`, `archiveVersion(slug)`, and `promoteVersion(slug)` plus matching admin actions.

- [ ] Write failing service tests proving reads use no-store Core calls and mutations preserve slug, nullable region, skills, and capabilities.
- [ ] Run `pnpm --filter web test src/lib/services/__tests__/admin-soko-bot.service.test.ts` and confirm the missing methods fail.
- [ ] Add generated-client imports and typed wrapper functions in `core.shared.ts`; expose them from `createCoreClient`.
- [ ] Implement the service methods without importing database packages or generated internals outside the client boundary.
- [ ] Write failing action tests for invalid payloads, successful create/update/promote/archive calls, and path revalidation.
- [ ] Run `pnpm --filter web test src/lib/actions/admin-soko-bots/__tests__/action.test.ts` and confirm the missing actions fail.
- [ ] Add Zod validation and server actions using the existing admin-session, error mapping, and `ActionResultDto` patterns.
- [ ] Rerun both targeted test files and confirm they pass.

### Task 2: Version list, form, detail, and lifecycle controls

**Files:**
- Create: `apps/web/src/app/(app)/admin/soko-bots/versions/page.tsx`
- Create: `apps/web/src/app/(app)/admin/soko-bots/versions/new/page.tsx`
- Create: `apps/web/src/app/(app)/admin/soko-bots/versions/[slug]/page.tsx`
- Create: `apps/web/src/components/admin/soko-bots/soko-bot-version-list.tsx`
- Create: `apps/web/src/components/admin/soko-bots/soko-bot-version-form.client.tsx`
- Create: `apps/web/src/components/admin/soko-bots/soko-bot-version-detail.tsx`
- Create: `apps/web/src/components/admin/soko-bots/soko-bot-version-actions.client.tsx`
- Create: `apps/web/src/components/admin/soko-bots/__tests__/soko-bot-version-authoring.test.tsx`
- Modify: `apps/web/src/app/(app)/admin/soko-bots/page.tsx`
- Modify: `apps/web/src/lib/soko-bot/constants.ts`

**Interfaces:**
- Consumes: Task 1 service reads/actions, `AdminSokoBotQuality`, and `SokoBotLabRun`.
- Produces: dedicated list/create/detail pages, duplicate-prefilled form state, built-in read-only presentation, and confirmed promotion/archive controls.

- [ ] Write failing component tests proving list badges/actions, default state, built-in read-only notice, duplicate slug clearing with every other field preserved, editable model fallback, empty-tools explanation, and promotion confirmation copy.
- [ ] Run `pnpm --filter web test src/components/admin/soko-bots/__tests__/soko-bot-version-authoring.test.tsx` and confirm the missing components fail.
- [ ] Add route constants and the Versions entry point beside Behaviour Lab on the admin overview.
- [ ] Implement the server-rendered versions table with View, Duplicate, and Edit actions appropriate to ownership type.
- [ ] Implement the client form with controlled shadcn Input, Textarea, Select, Popover/Command model picker, and Checkbox groups. Initialize duplicate drafts as `{ slug: "", ...sourceFields }`.
- [ ] Implement create and detail routes using `nuqs/server` parsers for `from` and `mode`; return `notFound()` for unknown slugs and ignore edit mode for built-ins.
- [ ] Implement the detail component with default/authored badges, visible built-in read-only notice, full prompt, real-run stats, and lab-history summary.
- [ ] Implement promotion and archive AlertDialogs. Disable archive for the current default and explain that another version must be promoted first.
- [ ] Rerun the targeted component tests and confirm they pass.

### Task 3: Behaviour Lab deep link and localized product copy

**Files:**
- Modify: `apps/web/src/app/(app)/admin/soko-bots/lab/page.tsx`
- Modify: `apps/web/src/components/admin/soko-bots/scenario-lab.client.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/de.json`
- Modify: `apps/web/messages/es.json`
- Create or modify: `apps/web/src/components/admin/soko-bots/__tests__/scenario-lab-version-state.test.tsx`

**Interfaces:**
- Consumes: detail-page link `/admin/soko-bots/lab?version=<slug>`.
- Produces: `version` URL state synchronized with successful lab version changes and an initial deep-linked selection applied to the admin’s bot.

- [ ] Write a failing lab test showing a valid URL-selected version is applied and successful picker changes update URL state.
- [ ] Run `pnpm --filter web test src/components/admin/soko-bots/__tests__/scenario-lab-version-state.test.tsx` and confirm it fails.
- [ ] Add the `nuqs` version state while retaining the bot’s current version as the fallback and never displaying a version before Core accepts the switch.
- [ ] Add concise English copy for Versions, Form, Detail, Actions, and Lab state, then provide fluent German and Spanish equivalents with identical key structure.
- [ ] Run `pnpm --filter web messages:parity` and the targeted lab test; confirm both pass.

### Task 4: Review, browser proof, verification, and commit

**Files:**
- Review all files changed by Tasks 1-3 and the approved spec/plan.
- Modify Core route registration and version/quality safeguards when browser or regression tests expose API correctness issues.
- Regenerate the Web Core client if those safeguards change the OpenAPI contract.

**Interfaces:**
- Consumes: complete version-authoring UI.
- Produces: a reviewed, verified local commit without unrelated worktree changes.

- [ ] Run targeted Web tests for all new and modified behavior.
- [ ] Inspect `/admin/soko-bots/versions`, a built-in detail, a duplicate form, an authored detail/edit form, and the promotion dialog against the already-running local stack; capture a screenshot for UI verification without starting another server.
- [ ] Review `git diff --check`, `git diff --stat`, and the full scoped diff. Fix every issue found and repeat the review until clean.
- [ ] Under Node 24 with `ulimit -n 65536`, run `pnpm typecheck`, `pnpm exec biome check .`, `pnpm --filter web test`, and `pnpm --filter core test`.
- [ ] Stage the approved Web files, documentation, and the directly required Core correctness fixes while preserving unrelated changes.
- [ ] Commit locally with `feat(admin): add Soko Bot version authoring` and a body recording the dedicated-route/read-only design, static-route ordering, zero-metric fallback, and archive-default guard decisions.
- [ ] Report the commit SHA and exact verification summaries. Do not push or deploy.
