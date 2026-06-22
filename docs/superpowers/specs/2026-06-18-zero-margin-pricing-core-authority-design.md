# Move credit pricing authority into Core (fix PR #3218 pricing bypass)

- **Date:** 2026-06-18
- **Linear:** SOK-603 (follow-up fix on PR #3218)
- **Status:** Approved design, ready for implementation plan
- **Target branch:** `cursor/move-stripe-billing-to-core-1490` (the PR being fixed)

## Problem

PR #3218 moves Stripe billing from web into Core, but exposes pricing authority to
the client:

- `POST /v1/checkout/credits` accepts a client-supplied `priceLookupKeyOverride`,
  and the accepted enum includes the zero-margin key `credit_0_margin`. The
  handler forwards it unchecked to `stripeBillingService.createCreditCheckoutSession`,
  which calls `stripeClient.getPriceByLookupKey(override)` and uses that price's
  `unit_amount` for the checkout. Any authenticated user can therefore POST
  `priceLookupKeyOverride: "credit_0_margin"` and buy credits at zero margin —
  a chargeable privilege escalation.
- `GET /v1/products/credits/catalog` accepts a client-supplied `extraLookupKeys`
  query with the same shape (display-only, lower severity, but same trust flaw).

Before this PR, the zero-margin decision was made **server-side only** in web via
`resolveZeroMarginTopUpLookupKey(session.user.email)` — an email-domain allowlist —
and the client could never influence pricing. The PR carried the override across
the web→Core boundary as a request field, turning a server-side decision into a
client-controlled one.

## Goals

1. Core is the **sole authority** on credit pricing and zero-margin eligibility,
   derived from the authenticated user — never from request input.
2. The web app is **fully margin-agnostic**: no margin lookup keys, no allowlist,
   no eligibility logic, no tier-selection-by-margin. Web asks Core for "credit
   pricing for my account" and renders what it gets back.
3. Preserve the existing purchase UX (quick-amount cards, as-you-type pricing,
   "savings vs base" comparison) without adding per-amount server round-trips.

## Non-goals

- PR #3218 review findings #2 (Core test coverage for moved billing logic),
  #3 (invoice-email Stripe sync resilience), and #4 (checkout-session scoping)
  are tracked separately and are out of scope here.
- No change to Stripe products, prices, or the underlying margin tiers themselves.

## Design

### New Core contract

`GET /v1/products/credits/catalog` takes **no query params** and returns an
account-resolved, margin-free price structure:

```jsonc
{
  "currency": "eur",
  "tiers": [
    { "minCredits": 1, "amountPerCredit": 120 },
    { "minCredits": 10001, "amountPerCredit": 115 },
    { "minCredits": 100001, "amountPerCredit": 110 }
  ],
  "referenceAmountPerCredit": 120,   // drives the "savings vs base" display
  "canPurchaseOnFreePlan": false     // zero-margin exception, margin-free name
}
```

- `tiers` are ascending by `minCredits`, carry **no margin names / lookup keys**.
- Core internally selects the zero-margin vs standard curve from the user's email
  + allowlist. Zero-margin accounts receive their curve (a single flat tier is
  acceptable) and `referenceAmountPerCredit` set so no misleading savings show.
- `canPurchaseOnFreePlan` replaces web's former `zeroMarginTopUpEnabled` signal
  for the free-plan purchase gate, named without exposing margin semantics.

`POST /v1/checkout/credits` accepts only `credits`, `organizationId`,
`returnPath`, `promotionCodeId`, `origin`, `ttlDays` — **no** `priceLookupKeyOverride`.
Core derives the curve from `userContext.userId` and prices server-side.

### Core changes

1. **`apps/core/src/lib/zero-margin-top-up.ts`** (new) — move the ~100-domain
   allowlist + `isZeroMarginTopUpDomain` + `resolveZeroMarginTopUpLookupKey(email)`
   from `apps/web/src/lib/flags/zero-margin-top-up.ts`. Core-only; never reaches a
   browser bundle.
2. **`apps/core/src/services/stripe-billing.service.ts`**
   - Add `resolveZeroMarginLookupKeyForUser(userId)`: load the user's email via
     `userRepository` (the same lookup `ensureStripeCustomerId` already performs)
     and run the allowlist.
   - Build the opaque tier structure (`currency`, `tiers`, `referenceAmountPerCredit`,
     `canPurchaseOnFreePlan`) for the account, choosing the curve internally.
   - `createCreditCheckoutSession`: **drop** the `priceLookupKeyOverride` parameter
     from the public input; derive the lookup key internally from `userId`.
3. **`apps/core/src/schemas/billing.schema.ts`**
   - Remove `priceLookupKeyOverride` from `createCreditCheckoutSessionSchema`.
   - Remove `creditTopUpCatalogQuerySchema` (`extraLookupKeys`).
   - Replace the lookup-key-keyed `creditTopUpPriceCatalogSchema` record with the
     new structured response schema above.
4. **Route handlers**
   - `apps/core/src/routes/v1/checkout/credits/post.ts`: stop forwarding the override.
   - `apps/core/src/routes/v1/products/credits/catalog/get.ts`: drop the query,
     pass `userContext.userId` to the service.
5. Regenerate the web client: `pnpm --filter web generate:core:snapshot`. Do not
   hand-edit generated files.

### Shared utils (`@sokosumi/utils`)

6. The margin lookup-key constants/helpers (`ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY`,
   `CREDIT_TOPUP_LOOKUP_KEYS`, `BASE_CREDIT_TOPUP_LOOKUP_KEY`,
   `getCreditTopUpLookupKeyByCredits`, …) remain in `@sokosumi/utils` but their
   **only consumer becomes Core**. Web no longer imports them.
7. Add generic, margin-free tier math for web to consume: e.g.
   `selectTierByCredits(tiers, credits)` and a total/savings helper operating on
   the opaque `{ minCredits, amountPerCredit }[]` + `referenceAmountPerCredit`.
   (`getCreditTopUpTotalMinorUnits` / `isPositiveIntegerCredits` already fit and
   are margin-free — reuse them.)

### Web changes (margin-agnostic)

8. **`apps/web/src/components/credits/credits-form.tsx`** — remove all margin
   imports and the `priceLookupKeyOverride` prop. Recompute `getCreditPricingSummary`
   from the opaque `tiers` + `referenceAmountPerCredit` using the generic helpers
   (pick tier by volume, `total = credits * amountPerCredit`, savings vs reference).
9. **`apps/web/src/components/billing/credits-section.tsx`** — fetch the new catalog
   shape; drop the `priceLookupKeyOverride` prop threading.
10. **`apps/web/src/app/(app)/billing/page.tsx`** — delete `zeroMarginTopUpEnabled()`
    and `creditsPriceLookupKeyOverride`. Compute
    `canPurchaseCredits = isOwnerOrAdmin && (currentPlan !== "free" || catalog.canPurchaseOnFreePlan)`.
11. **`apps/web/src/lib/actions/credits/action.ts`** — remove the override
    resolution; send only `credits` / `organizationId` / `returnPath`.
12. **Delete `apps/web/src/lib/flags/zero-margin-top-up.ts`** and the allowlist.
    Keep `getEmailDomain` (`apps/web/src/lib/utils/email.ts`) — still used by
    `apps/web/src/lib/hermes/beta-access.ts`.
13. **Audit other callers** of the catalog / checkout / override during
    implementation: `apps/web/src/app/(app)/components/onboarding-dialog-loader.tsx`
    and `apps/web/src/app/(app)/credits/components/purchase-tracker.tsx`.

### Tests

14. **Core** (`apps/core/src/services/__tests__/stripe-billing.service.test.ts`,
    matching the existing convention):
    - Allowlist resolution (eligible domain, ineligible domain, missing email).
    - Catalog returns the correct curve and `canPurchaseOnFreePlan` per eligibility.
    - Checkout prices server-side from the resolved curve **regardless of request
      body** — regression test asserting no client field can change the price
      (the `priceLookupKeyOverride` field no longer exists / is ignored).
15. **Web** — update billing / credits tests to the opaque structure; delete the
    zero-margin flag test.

## Verification

- `pnpm check`
- `pnpm --filter @sokosumi/core test`
- `pnpm --filter web test` (billing / credits / onboarding)
- `pnpm --filter @sokosumi/utils test`
- Grep `apps/web/src` for `margin`, `LookupKey`, `priceLookupKeyOverride`,
  `extraLookupKeys`, `zeroMargin` → expect zero matches in source.

## Risks / notes

- The web client must be regenerated, not hand-edited; the response-shape change
  is a breaking client change landing in the same commit set.
- Deploy ordering unchanged: Core retains all `STRIPE_*` env; web drops the
  Stripe vars already removed by the PR.
- Open detail for spec review: whether zero-margin accounts should display any
  "savings" at all (recommendation: no — set `referenceAmountPerCredit` equal to
  the zero-margin per-credit so no comparison renders).
