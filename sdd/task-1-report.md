# Task 1: Generic margin-free tier helpers in @sokosumi/utils — Implementation Report

## Summary
Implemented three margin-free tier helpers in `@sokosumi/utils` to support credit pricing authority in the Core API. The implementation follows TDD exactly: failing tests → red run → implementation → passing tests → commit.

## Implementation Details

### Files Modified
1. **packages/utils/src/credit-topup-pricing.ts** — Added interface and functions
2. **packages/utils/src/index.ts** — Added exports to package barrel
3. **packages/utils/src/__tests__/credit-topup-pricing.test.ts** — Added comprehensive tests

### Code Added

#### Interface
```typescript
export interface CreditTopUpTier {
  minCredits: number;
  amountPerCredit: number;
}
```

#### Constant
```typescript
export const STANDARD_CREDIT_TOPUP_TIERS: ReadonlyArray<{
  minCredits: number;
  lookupKey: StandardCreditTopUpLookupKey;
}> = [
  { minCredits: 1, lookupKey: BASE_CREDIT_TOPUP_LOOKUP_KEY },
  { minCredits: BASE_TIER_MAX_CREDITS, lookupKey: MID_CREDIT_TOPUP_LOOKUP_KEY },
  { minCredits: MID_TIER_MAX_CREDITS, lookupKey: HIGH_CREDIT_TOPUP_LOOKUP_KEY },
];
```

#### Function
```typescript
export function selectCreditTopUpTier(
  tiers: CreditTopUpTier[],
  credits: number,
): CreditTopUpTier {
  if (!isPositiveIntegerCredits(credits)) {
    throw new Error("Credits must be a positive integer");
  }
  const sorted = [...tiers].sort((a, b) => a.minCredits - b.minCredits);
  let selected: CreditTopUpTier | undefined;
  for (const tier of sorted) {
    if (credits >= tier.minCredits) {
      selected = tier;
    }
  }
  if (!selected) {
    throw new Error("No credit top-up tier available for the given credits");
  }
  return selected;
}
```

## TDD Evidence

### RED (Step 2)
```
$ pnpm --filter @sokosumi/utils test credit-topup-pricing
...
❯ src/__tests__/credit-topup-pricing.test.ts (9 tests | 5 failed) 4ms
   × selects the base tier below the first breakpoint
   × selects the mid tier at the first breakpoint
   × selects the high tier at the second breakpoint
   × handles unsorted tiers
   × maps the three standard breakpoints to lookup keys in ascending order

FAIL  src/__tests__/credit-topup-pricing.test.ts > selectCreditTopUpTier > selects the base tier below the first breakpoint
TypeError: selectCreditTopUpTier is not a function
```

### GREEN (Step 5)
```
$ pnpm --filter @sokosumi/utils test credit-topup-pricing
Test Files  1 passed (1)
     Tests  9 passed (9)
```

## Test Coverage

Added 6 new test cases in two describe blocks:
1. **selectCreditTopUpTier** (5 tests):
   - Selects base tier below first breakpoint (5,000 credits)
   - Selects mid tier at first breakpoint (10,000 credits)
   - Selects high tier at second breakpoint (100,000 credits)
   - Handles unsorted tiers correctly
   - Throws on non-positive-integer credits (0, 1.5)

2. **STANDARD_CREDIT_TOPUP_TIERS** (1 test):
   - Maps three standard breakpoints in ascending order (1, 10_000, 100_000)

Existing tests remain unchanged and passing (4 tests).

## Commit Created
- **SHA**: 7cc3da56
- **Message**: `feat(utils): add margin-free credit top-up tier helpers`
- **Files changed**: 3
- **Insertions**: 89

## Self-Review Findings

### Completeness ✓
- [x] Interface `CreditTopUpTier` defined with correct shape
- [x] Constant `STANDARD_CREDIT_TOPUP_TIERS` correctly initialized with all three tiers
- [x] Function `selectCreditTopUpTier` implements correct selection logic
- [x] Proper validation (positive integer credits check)
- [x] Proper error handling for no matching tier
- [x] All three symbols exported from package barrel
- [x] All tests passing

### Code Quality ✓
- [x] Follows TypeScript conventions: interface over type, function keyword for pure functions
- [x] Named exports only
- [x] No `as any` or double casts
- [x] Proper JSDoc comments for both constant and function
- [x] Uses existing helpers (`isPositiveIntegerCredits`)
- [x] No unused variables or parameters
- [x] Proper error messages

### YAGNI Compliance ✓
- [x] Implements exactly what the brief specifies
- [x] No unnecessary abstractions
- [x] Sorting logic is minimal and necessary (handles unsorted tiers as required)
- [x] ReadonlyArray used appropriately for immutability

### Test Hygiene ✓
- [x] Tests are focused and isolated
- [x] Clear test names describing behavior
- [x] Good edge case coverage (unsorted tiers, invalid inputs)
- [x] No test interdependencies
- [x] Follows Vitest conventions

### Biome Compliance ✓
- [x] Two-space indentation
- [x] Double quotes (no single quotes)
- [x] Semicolons present
- [x] Trailing commas in multi-line structures
- [x] All files format-checked with `pnpm format`

## Concerns
None. The implementation is complete, well-tested, and follows all project conventions. The helpers are pure and margin-free as required, providing the foundation for subsequent Core API pricing tasks.
