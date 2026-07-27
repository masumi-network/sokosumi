# Task 5 Report: Web — share view parity

## Status

Complete.

## TDD

- Red: added focused share-page tests for settled credit-only activity and attempted out-of-credits charge copy.
- Verified red with `pnpm --filter web test src/app/share/\[token\]/page.test.tsx` before production changes.
- Green: same focused test file passes after mirroring Task 4 rules into share view.

## What changed

1. `apps/web/src/app/share/components/shared-task-view.tsx`
   - Mirrored Task 4 charge phrase rules: settled uses `actionChargedCredits`, attempted uses `actionTriedChargedCredits`.
   - Mirrored action priority: comment, then status, then charge phrase, then status fallback.
   - Mirrored secondary charge line rule: only render charge detail for comment/status rows that also have charge copy.

2. `apps/web/src/app/share/[token]/page.test.tsx`
   - Added translation mock coverage for `actionTriedChargedCredits`.
   - Added regression tests for settled credit-only rows and attempted out-of-credits rows.
   - Updated existing mixed comment+charge fixture to include `transactionId` so it remains a settled-charge case under new rules.

## Verification

- `pnpm --filter web test src/app/share/\[token\]/page.test.tsx` — pass (5/5).
- `pnpm --filter web exec biome check "src/app/share/components/shared-task-view.tsx" "src/app/share/[token]/page.test.tsx"` — pass.

## Concerns

- Local shell still resolves `node` to v22, so pnpm emits engine warnings even though test and Biome checks pass.

---

## Task 5 follow-up: Core public-share contract fix

### Status

Complete.

### What changed

1. `apps/core/src/schemas/public-share.schema.ts`
   - Added `transactionId` to `publicSharedTaskMilestoneSchema`.
2. `apps/core/src/helpers/public-share.ts`
   - Added `transactionId` to public milestone mapping.
   - Switched milestone credits mapping to prefer settled negative `transaction.amount`, else fall back to attempted `event.cents`.
   - Kept credit-only milestones when they have no status/comment.
3. `apps/core/src/helpers/public-share.test.ts`
   - Added regression coverage for settled spend, attempted out-of-credits spend, and credit-only milestones.
4. `apps/web/src/app/share/[token]/page.test.tsx`
   - Tightened attempted charge assertion to require both status-change copy and attempted-charge copy.
5. `apps/web/src/lib/clients/generated/core/*`
   - Regenerated from Core snapshot. `PublicSharedTaskMilestone` now includes typed `transactionId`.

### Verification

- `pnpm --filter core test src/helpers/public-share.test.ts` — pass (3/3).
- `pnpm --filter web generate:core:snapshot` — pass; regenerated Core client from snapshot.
- `pnpm --filter web typecheck` — pass.
- `pnpm --filter web test src/app/share/\[token\]/page.test.tsx` — pass (5/5).
- `pnpm exec biome check "apps/core/src/helpers/public-share.ts" "apps/core/src/helpers/public-share.test.ts" "apps/core/src/schemas/public-share.schema.ts" "apps/web/src/app/share/[token]/page.test.tsx" "apps/web/src/app/share/components/shared-task-view.tsx"` — pass.

### Concerns

- Shell still resolves Node v22, so pnpm prints engine warnings. Commands still passed.
