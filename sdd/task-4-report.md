# Task 4 Report: Core service — server-side pricing authority

## What changed

### `apps/core/src/services/stripe-billing.service.ts`
- Updated imports: added `STANDARD_CREDIT_TOPUP_TIERS` from `@sokosumi/utils`; added `resolveZeroMarginTopUpLookupKey` from `@/lib/zero-margin-top-up`; added `CreditTopUpPricing` type from `@/schemas/billing.schema`; removed unused `CreditPrice` type import from `@/clients/stripe.client`.
- Added private helper `resolveZeroMarginLookupKeyForUser(userId)`: looks up user email from DB, delegates to `resolveZeroMarginTopUpLookupKey`, returns the zero-margin key or `undefined`.
- Replaced `getCreditTopUpPriceCatalog(extraLookupKeys)` with `getCreditTopUpPricing(userId)`: resolves zero-margin entitlement from the authenticated user's email server-side; returns a single zero-margin tier with `canPurchaseOnFreePlan: true` for allowlisted users, or the three standard volume tiers with `canPurchaseOnFreePlan: false` for everyone else.
- Changed `createCreditCheckoutSession`: removed `priceLookupKeyOverride` from the params type; replaced the old price-resolution block (which trusted the override) with a server-side call to `resolveZeroMarginLookupKeyForUser(userId)` followed by `stripeClient.getCreditTopUpPriceByCredits(credits, zeroMarginLookupKey)`.

### `apps/core/src/services/__tests__/stripe-billing.service.test.ts` (new)
New test file with 4 tests covering `getCreditTopUpPricing` (two cases) and the critical checkout pricing authority (two cases).

## TDD evidence

### RED (Step 2)
```
pnpm --filter @sokosumi/core test stripe-billing.service
```
Result: 4 tests FAILED — `getCreditTopUpPricing` did not exist; `createCreditCheckoutSession` still used the client-supplied override path.

### GREEN (Step 4)
```
pnpm --filter @sokosumi/core test stripe-billing.service
```
Result: 4 tests PASSED (201ms).

Confirmed still GREEN after `pnpm format` fixed 1 trailing-comma nit.

## Security regression assertions

### `getCreditTopUpPricing`
- `"returns the three standard tiers for a non-allowlisted user"`: mocks prisma to return `bob@example.com`. Asserts `canPurchaseOnFreePlan: false` and tiers use `credit_20_margin / credit_15_margin / credit_10_margin` prices (120/115/110). Proves standard users never receive zero-margin pricing.
- `"returns a single zero-margin tier for an allowlisted user"`: mocks prisma to return `alice@nmkr.io` (nmkr.io is in the allowlist). Asserts `canPurchaseOnFreePlan: true`, single tier `{ minCredits: 1, amountPerCredit: 100 }` from the `credit_0_margin` key. Proves allowlisted users get zero-margin pricing purely from their email.

### `createCreditCheckoutSession pricing authority`
- `"prices a non-allowlisted user from the volume curve (no zero-margin key)"`: mocks prisma to return `bob@example.com`. Asserts `getCreditTopUpPriceByCredits` is called with `(5_000, undefined)` — the zero-margin key is absent. This is the regression guard: there is no way for a client to inject `"credit_0_margin"` for a non-allowlisted user.
- `"prices an allowlisted user with the zero-margin key, regardless of input"`: mocks prisma to return `alice@nmkr.io`. Asserts `getCreditTopUpPriceByCredits` is called with `(5_000, "credit_0_margin")`. Confirms allowlisted users are always routed to zero-margin — and crucially, neither test has any client input for a pricing override, because the param no longer exists on the service method.

These four tests together prove that:
1. The entitlement gate (`resolveZeroMarginTopUpLookupKey`) is resolved from the DB-backed email, not from any client-supplied value.
2. The `priceLookupKeyOverride` field has been removed from the service interface — it cannot be passed at all.
3. An allowlisted user always gets `credit_0_margin`; a non-allowlisted user never does — driven solely by server-side email lookup.

## Files changed
- `apps/core/src/services/stripe-billing.service.ts`
- `apps/core/src/services/__tests__/stripe-billing.service.test.ts`

## Self-review findings

**Security claim verified**: The `priceLookupKeyOverride` field is fully removed from the `createCreditCheckoutSession` params type. TypeScript will reject any caller that tries to pass it. The only pricing path is via `resolveZeroMarginLookupKeyForUser` which fetches the email from Prisma — the client has zero influence.

**Expected tsc errors in route files**: `routes/v1/products/credits/catalog/get.ts` still references `getCreditTopUpPriceCatalog` (which no longer exists), and `checkout/credits/post.ts` may still pass `priceLookupKeyOverride`. Both are confined to route files scheduled for Task 5 — they do not affect test execution. Confirmed the new test file compiles and runs cleanly.

**No concerns**: Implementation matches the brief exactly. No double casts, no `any`, proper `function` keyword for helpers, named exports only.

## Concerns
None.
