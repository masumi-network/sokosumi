# Task 7 Report

## Files Changed

### `apps/web/src/lib/clients/core.shared.ts`
1. Removed `CreditTopUpLookupKey` from the `@sokosumi/utils` import (only `NoticeKind` remains).
2. Rewrote `getCreditTopUpPriceCatalog` to take no arguments: dropped `extraLookupKeys?: string` param, removed the conditional `query: extraLookupKeys ? { extraLookupKeys } : undefined` from the inner call.
3. Removed `priceLookupKeyOverride?: CreditTopUpLookupKey;` from the `createCreditCheckoutSession` body parameter type.

### `apps/web/src/components/credits/credits-form.tsx`
1. Replaced `@sokosumi/utils` import (which had `BASE_CREDIT_TOPUP_LOOKUP_KEY`, `CreditTopUpLookupKey`, `getCreditTopUpLookupKeyByCredits`, `getCreditTopUpTotalMinorUnits`, `isPositiveIntegerCredits`) with the three generic utils: `getCreditTopUpTotalMinorUnits`, `isPositiveIntegerCredits`, `selectCreditTopUpTier`.
2. Replaced generated-types import (`CreditTopUpPrice`, `CreditTopUpPriceCatalog`, `Organization`) with `CreditTopUpPricing`, `Organization`.
3. Rewrote `CreditPricingSummary` interface: removed `price: CreditTopUpPrice` and `baseTierTotalMinorUnits`; added `amountPerCredit: number`, `currency: string`, `referenceTotalMinorUnits: number`.
4. Rewrote `getCreditPricingSummary` to use `selectCreditTopUpTier(pricing.tiers, credits)` for tier selection and `pricing.referenceAmountPerCredit` for reference price — no lookup keys, no margin knowledge.
5. Updated `CreditsFormProps`: renamed `priceCatalog: CreditTopUpPriceCatalog` to `pricing: CreditTopUpPricing`; dropped `priceLookupKeyOverride?: CreditTopUpLookupKey`.
6. Updated component destructure accordingly.
7. Updated all call sites of `getCreditPricingSummary` to pass `pricing` and drop the override arg.
8. In the quick-amount map loop: renamed `pricing` local var to `pricingSummary` to avoid shadowing the prop, replaced all `.price.currency` → `.currency`, `.price.amountPerCredit` → `.amountPerCredit`, `.baseTierTotalMinorUnits` → `.referenceTotalMinorUnits`.
9. In computed vars for selected credits: `selectedPricing.price.currency` → `selectedPricing.currency`, `selectedPricing.baseTierTotalMinorUnits` → `selectedPricing.referenceTotalMinorUnits`.
10. Removed `const selectedPrice = selectedPricing?.price ?? null;`; replaced footer guard `selectedPrice ?` with `selectedPricing !== null ?`; replaced `selectedPrice.amountPerCredit`/`selectedPrice.currency` with `selectedPricing.amountPerCredit`/`selectedPricing.currency`.

## tsc Output

```
Found 12 errors in 3 files:
  2  src/components/billing/credits-section.tsx   (Task 8)
  9  src/components/credits/__tests__/credits-form.test.tsx  (Task 9)
  1  src/lib/actions/credits/action.ts            (Task 8)
```

Zero errors in `credits-form.tsx` or `core.shared.ts`. All remaining errors are confined to Task-8 files (`credits-section.tsx`, `action.ts`) and Task-9 test files, exactly as expected.

## Grep Gate

```
grep -nE "margin|LookupKey|priceLookupKeyOverride" \
  apps/web/src/components/credits/credits-form.tsx \
  apps/web/src/lib/clients/core.shared.ts
```
→ No matches.

## Commit

`ffee27dd` — refactor(web): compute credit prices from opaque margin-free pricing

## Self-Review

**Pricing math equivalence:**
- Tier selection: old code used `getCreditTopUpLookupKeyByCredits(credits, override)` then indexed into a catalog dict. New code uses `selectCreditTopUpTier(pricing.tiers, credits)` — same semantic: picks the tier by credit volume. No override needed since the server now handles margin-free pricing server-side.
- Total: `getCreditTopUpTotalMinorUnits(credits, tier.amountPerCredit)` — identical helper, same math.
- Reference total: old code used `priceCatalog[BASE_CREDIT_TOPUP_LOOKUP_KEY].amountPerCredit`; new code uses `pricing.referenceAmountPerCredit` — same concept (the baseline/reference price for discount comparison).
- Savings: `referenceTotalMinorUnits - totalMinorUnits` — unchanged arithmetic.
- Currency comparison guard removed: old code had `baseTierPrice.currency === price.currency &&` before the discount check. New code omits this because the server now guarantees a single currency in `CreditTopUpPricing`, so the guard is implicit.

**JSX fields**: All renders produce the same output — total, compare-at (reference total), savings, per-credit cost, and currency are all preserved. The loop variable was renamed `pricingSummary` (vs old `pricing`) to avoid shadowing the `pricing` prop — this is a non-functional improvement.

**Concerns**: None.
