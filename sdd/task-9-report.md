# Task 9 Report: Update web tests for margin-free credit pricing contract

## What changed per test file

### `apps/web/src/components/credits/__tests__/credits-form.test.tsx`
- Replaced `CreditTopUpPriceCatalog` import and `priceCatalog` fixture with `CreditTopUpPricing` and a `pricing` object (`{ currency: "eur", tiers: [{minCredits:1,amountPerCredit:120},{minCredits:10_000,amountPerCredit:115},{minCredits:100_000,amountPerCredit:110}], referenceAmountPerCredit:120, canPurchaseOnFreePlan:false }`).
- Replaced all `priceCatalog={priceCatalog}` render props with `pricing={pricing}`.
- Dropped the two tests that referenced `priceLookupKeyOverride` — the prop no longer exists on `CreditsForm`.
- Added two replacement tests: "shows correct total for a custom amount at a discounted tier" and "submits with returnPath when provided".
- Updated tier assertions to the actual formatter output: `EUR:1.2000 per credit` (tier 1), `EUR:1.1500 per credit` (tier 2), `EUR:1.1000 per credit` (tier 3). Key finding: 100,000 IS in quickAmounts, suppressing the footer per-credit element; tier 3 test uses 150,000 (not a quick-pick amount) to ensure the footer renders.

### `apps/web/src/app/(app)/billing/__tests__/page.test.tsx`
- Removed `zeroMarginTopUpEnabledMock` and `vi.mock("@/lib/flags/zero-margin-top-up", ...)` entirely.
- Added `getCreditTopUpPriceCatalogMock` to the core client mock factory.
- Added helper `createCreditTopUpPricing({ canPurchaseOnFreePlan? })` returning the new pricing shape.
- Replaced three zero-margin-flag tests with `canPurchaseOnFreePlan`-based equivalents.
- Removed `priceLookupKeyOverride` from all `creditsSectionMock` assertions.

### `apps/web/src/lib/actions/credits/__tests__/action.test.ts`
- Removed `resolveZeroMarginTopUpLookupKeyMock`, `vi.mock("@/lib/flags/zero-margin-top-up", ...)`, and its `beforeEach` setup.
- Removed the two tests about the lookup key override.
- Added "passes returnPath to the checkout session when provided" asserting `{ organizationId, credits, returnPath, origin }` — no `priceLookupKeyOverride`.

## Orphaned test deletion
- `apps/web/src/lib/flags/__tests__/zero-margin-top-up.test.ts` deleted via `git rm`. The `__tests__/` directory retains `hermes-beta.test.ts`.
- `apps/web/src/app/(app)/components/__tests__/onboarding-dialog-loader.test.tsx` — grepped, no flag references; left untouched.

## Suite results
| Suite | Tests | Result |
|---|---|---|
| `credits-form` | 8 | PASS |
| `billing/__tests__/page` | 11 | PASS |
| `actions/credits` | 5 | PASS |

## web tsc result
`pnpm --filter web exec tsc --noEmit` → 0 errors.

## Files changed
- `apps/web/src/components/credits/__tests__/credits-form.test.tsx` — modified
- `apps/web/src/app/(app)/billing/__tests__/page.test.tsx` — modified
- `apps/web/src/lib/actions/credits/__tests__/action.test.ts` — modified
- `apps/web/src/lib/flags/__tests__/zero-margin-top-up.test.ts` — deleted

## Commits created
- `2072d762` test(web): update credit pricing tests for margin-free contract
- `b9ecbda5` test(web): include billing page test in pricing contract update

(Note: the billing page test was not staged in the first commit due to a shell-escaping issue with parentheses in the path; a follow-up commit added it.)

## Self-review findings
- All assertions verify real pricing output: tier selection, formatter output, submit payload contents.
- The tier-crossing test verifies both tier 1→2 (at 10,000) and tier 2→3 (at 150,000 — a non-quick-pick amount).
- The `canPurchaseOnFreePlan: true` billing page tests assert `isPurchaseEnabled: true` for free-plan users, directly verifying the behavioral contract.

## Concerns
None.
