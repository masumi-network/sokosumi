# Task 3 Completion Report: Reshape the Core Billing Schemas

## Summary
Task 3 successfully restructured the Core billing schemas to replace the lookup-key-keyed credit catalog response with a margin-free pricing schema, removing client-supplied price override capabilities.

## Changes Made

### File Modified
- `apps/core/src/schemas/billing.schema.ts`

### Detailed Changes

#### Step 1: Added New Pricing Schemas
Added two new schemas after `creditTopUpPriceSchema`:

1. **`creditTopUpTierSchema`** (lines 27-32)
   - Structure: `{ minCredits: number; amountPerCredit: number }`
   - Validates tier-based pricing with minimum credit quantities
   - Exports OpenAPI definition "CreditTopUpTier"

2. **`creditTopUpPricingSchema`** (lines 34-43)
   - Structure: `{ currency: string; tiers: CreditTopUpTier[]; referenceAmountPerCredit: number; canPurchaseOnFreePlan: boolean }`
   - Margin-free pricing schema with tiered support
   - Exports OpenAPI definition "CreditTopUpPricing"

3. **`CreditTopUpPricing` type** (line 45)
   - Inferred type export from `creditTopUpPricingSchema`
   - Follows existing z.infer pattern

#### Step 2: Removed Old Schemas
Deleted the following from the file:
- `creditTopUpPriceCatalogSchema` (was: `z.record(creditTopUpLookupKeySchema, creditTopUpPriceSchema)`)
- `creditTopUpCatalogQuerySchema` (was: query schema with `extraLookupKeys` field)
- `priceLookupKeyOverride` field from `createCreditCheckoutSessionSchema` (line 54 in original)

The checkout schema now contains only:
- `organizationId`
- `credits`
- `returnPath`
- `promotionCodeId`
- `origin`
- `ttlDays`

#### Step 3: Cleanup Check
Ran grep to check for unused imports/exports:
```
grep -rn "creditTopUpPriceCatalogSchema\|creditTopUpCatalogQuerySchema\|creditTopUpLookupKeySchema" apps/core/src
```

Results:
- `creditTopUpPriceCatalogSchema`: referenced only in `apps/core/src/routes/v1/products/credits/catalog/get.ts` (downstream, fixed in Task 4)
- `creditTopUpCatalogQuerySchema`: referenced only in `apps/core/src/routes/v1/products/credits/catalog/get.ts` (downstream, fixed in Task 4)
- `creditTopUpLookupKeySchema`: kept as per brief (Task 5 removes it after routes stop using it)
- All imports (`CREDIT_TOPUP_LOOKUP_KEYS`, `ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY`) kept as instructed

No unused imports in `billing.schema.ts` itself after cleanup.

#### Step 4: Type-Checking Results
Ran `pnpm --filter @sokosumi/core exec tsc --noEmit`

**Results:** 3 errors found, all in downstream files (expected):
- 1 error in `src/routes/v1/checkout/credits/post.ts:81` - Property 'priceLookupKeyOverride' does not exist (removed field)
- 2 errors in `src/routes/v1/products/credits/catalog/get.ts` - Missing exported members 'creditTopUpCatalogQuerySchema' and 'creditTopUpPriceCatalogSchema' (removed schemas)

**No errors in `billing.schema.ts` itself** ✓

#### Step 5: Formatting & Commit
- Ran `pnpm format` - no fixes needed, file already properly formatted
- Created commit: `df100a9c feat(core): replace credit catalog schema with margin-free pricing schema`

## Self-Review

### Changes Validation
1. ✓ New schemas added exactly as specified in brief
2. ✓ Old schemas removed as specified
3. ✓ priceLookupKeyOverride field removed from checkout schema
4. ✓ Imports retained per brief (creditTopUpLookupKeySchema kept for Task 5)
5. ✓ TypeScript formatting follows conventions (2-space indent, trailing commas, double quotes)
6. ✓ All OpenAPI definitions properly named
7. ✓ Type exports follow existing z.infer pattern

### Type Safety
- New schemas are well-formed Zod schemas with proper type inference
- The tier array pattern allows flexible, tiered pricing without hardcoded lookups
- The new schema removes coupling to Stripe lookup keys, enabling Core pricing authority

### Errors Confined Correctly
- All 3 tsc errors are in downstream files as documented
- None in the schema file itself
- Error messages clearly indicate what needs fixing in Tasks 4-5

## Concerns
None. Task completed as specified. The intentional type errors in downstream files confirm that:
1. The schema removal is correctly propagating
2. The downstream files will need updates (as planned in Tasks 4-5)
3. No circular dependencies or hidden breakages

## Files Changed
- `apps/core/src/schemas/billing.schema.ts` (+16 lines, -11 lines)

## Commit
- SHA: `df100a9c`
- Message: `feat(core): replace credit catalog schema with margin-free pricing schema`
