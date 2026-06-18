# Task 8 Report — Web: credits-section, billing page, purchase action; delete the zero-margin flag

## Files Changed

### `apps/web/src/components/billing/credits-section.tsx`
- Removed `import type { CreditTopUpLookupKey } from "@sokosumi/utils"`.
- Removed `priceLookupKeyOverride?: CreditTopUpLookupKey` from `CreditsSectionProps` interface and destructure.
- Changed `getCreditTopUpPriceCatalog(priceLookupKeyOverride)` → `getCreditTopUpPriceCatalog()` (no args), binding to `pricing`.
- Updated `<CreditsForm>` props: removed `priceLookupKeyOverride={...}` and `priceCatalog={priceCatalog}`; added `pricing={pricing}`.

### `apps/web/src/app/(app)/billing/page.tsx`
- Removed `ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY` from `@sokosumi/utils` import (kept `MemberRole`).
- Removed `import { zeroMarginTopUpEnabled } from "@/lib/flags/zero-margin-top-up"`.
- Removed `zeroMarginTopUpEnabled()` from the top-level `Promise.all`; removed the `isZeroMarginTopUpEnabled` binding.
- Removed the `creditsPriceLookupKeyOverride` derivation.
- Added `creditPricing` fetch via `coreClient.getCreditTopUpPriceCatalog()` after the `Promise.all`, deriving `canPurchaseOnFreePlan`.
- Replaced all three `isZeroMarginTopUpEnabled` usages (org branch `canPurchaseCredits`, personal branch `canPurchaseCredits`) with `canPurchaseOnFreePlan`.
- Removed `priceLookupKeyOverride={creditsPriceLookupKeyOverride}` from both `<CreditsSection>` usages (org and personal branches).

### `apps/web/src/lib/actions/credits/action.ts`
- Removed `import { resolveZeroMarginTopUpLookupKey } from "@/lib/flags/zero-margin-top-up"`.
- In `purchaseCredits`: removed `session` from destructure (no longer used), removed `priceLookupKeyOverride` resolution, dropped `priceLookupKeyOverride` from `createCreditCheckoutSession` call body.

### `apps/web/src/lib/flags/zero-margin-top-up.ts` — DELETED
- `git rm`'d. 169 lines removed.

## TSC Output

14 errors in 2 test files only:
- `src/components/credits/__tests__/credits-form.test.tsx` (9 errors — uses old `priceCatalog` prop and `CreditTopUpPriceCatalog` type; fixed in Task 9)
- `src/lib/flags/__tests__/zero-margin-top-up.test.ts` (5 errors — imports deleted module; fixed in Task 9)

No errors in the three edited source files.

## Grep Gate Result

Running the precise patterns:
```
grep -rnE "LookupKey|priceLookupKeyOverride|extraLookupKeys|zeroMargin|zeroMarginTopUp|ZERO_MARGIN|resolveZeroMargin" apps/web/src --include=*.ts --include=*.tsx | grep -v "/generated/" | grep -v "/__tests__/"
```
No matches.

(The broad `margin` pattern from the brief matches CSS layout uses in `globals.css`, `global-error.tsx`, `empty-state.tsx`, `export/pdf/route.ts`, `sidebar.tsx` — all unrelated to credit pricing. None of the credit-specific symbols remain.)

## Self-Review Findings

- Double-fetch: The billing page fetches `getCreditTopUpPriceCatalog()` once at page level to derive `canPurchaseOnFreePlan`, and `CreditsSection` fetches it again internally to pass `pricing` to `CreditsForm`. Per the plan this is acceptable.
- Both org and personal branches use `canPurchaseOnFreePlan` (two substitutions, both replaced).
- `session` param dropped from `purchaseCredits` destructure — it was only used to pass `session.user.email` to `resolveZeroMarginTopUpLookupKey`. Now unused, cleanly dropped.
- `pnpm format` reported "No fixes applied".

## Concerns

None.

## Commit

`16a037f2 feat(web): consume margin-free credit pricing from core`
4 files changed, 16 insertions(+), 169 deletions(-)
