# Credit Pricing Core Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Core the sole authority on credit-top-up pricing and zero-margin eligibility (derived from the authenticated user, never request input), and make the web app fully margin-agnostic.

**Architecture:** Core resolves zero-margin eligibility from the authenticated user's email + an allowlist that lives only in Core. The credit-catalog endpoint returns an opaque, account-resolved price structure (`currency`, `tiers[]`, `referenceAmountPerCredit`, `canPurchaseOnFreePlan`) with no margin lookup keys. Checkout derives the price curve server-side from `userId`; the client can no longer influence pricing. Web computes display prices from the opaque tiers using generic, margin-free helpers.

**Tech Stack:** TypeScript, pnpm workspace, Hono + `@hono/zod-openapi` (Core), Next.js App Router (web), Vitest, `@hey-api/openapi-ts` generated Core client, Stripe SDK, `@sokosumi/utils`.

## Global Constraints

- Pin exact dependency versions in `package.json` (no `^`/`~`/ranges); `workspace:*` only for internal packages.
- No `as any` / `as unknown as X` double casts.
- Two-space indent, semicolons, double quotes, trailing commas (Biome). Run `pnpm format` after substantial edits.
- Prefer interfaces over types; `function` keyword for pure functions; named exports.
- Web MUST NOT import `@sokosumi/database`, use Prisma, or use the Stripe SDK directly. All data/Stripe access is through Core endpoints.
- NEVER hand-edit generated files under `apps/web/src/lib/clients/generated/core/`. Regenerate via `pnpm --filter web generate:core:snapshot`.
- Unused vars/args prefixed `_`.
- After this change, `apps/web/src` source must contain zero references to `margin`, `LookupKey`, `priceLookupKeyOverride`, `extraLookupKeys`, or `zeroMargin`.

---

### Task 1: Generic margin-free tier helpers in `@sokosumi/utils`

**Files:**
- Modify: `packages/utils/src/credit-topup-pricing.ts`
- Modify: `packages/utils/src/index.ts` (export new symbols)
- Test: `packages/utils/src/__tests__/credit-topup-pricing.test.ts`

**Interfaces:**
- Produces:
  - `interface CreditTopUpTier { minCredits: number; amountPerCredit: number }`
  - `const STANDARD_CREDIT_TOPUP_TIERS: ReadonlyArray<{ minCredits: number; lookupKey: StandardCreditTopUpLookupKey }>`
  - `function selectCreditTopUpTier(tiers: CreditTopUpTier[], credits: number): CreditTopUpTier`
- Consumes (existing in this file): `isPositiveIntegerCredits`, `BASE_TIER_MAX_CREDITS` (10_000), `MID_TIER_MAX_CREDITS` (100_000), `BASE/MID/HIGH_CREDIT_TOPUP_LOOKUP_KEY`, `StandardCreditTopUpLookupKey`.

- [ ] **Step 1: Write the failing test**

Add to `packages/utils/src/__tests__/credit-topup-pricing.test.ts`:

```typescript
import {
  type CreditTopUpTier,
  selectCreditTopUpTier,
  STANDARD_CREDIT_TOPUP_TIERS,
} from "../credit-topup-pricing";

describe("selectCreditTopUpTier", () => {
  const tiers: CreditTopUpTier[] = [
    { minCredits: 1, amountPerCredit: 120 },
    { minCredits: 10_000, amountPerCredit: 115 },
    { minCredits: 100_000, amountPerCredit: 110 },
  ];

  it("selects the base tier below the first breakpoint", () => {
    expect(selectCreditTopUpTier(tiers, 5_000).amountPerCredit).toBe(120);
  });

  it("selects the mid tier at the first breakpoint", () => {
    expect(selectCreditTopUpTier(tiers, 10_000).amountPerCredit).toBe(115);
  });

  it("selects the high tier at the second breakpoint", () => {
    expect(selectCreditTopUpTier(tiers, 100_000).amountPerCredit).toBe(110);
  });

  it("handles unsorted tiers", () => {
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    expect(selectCreditTopUpTier(shuffled, 50_000).amountPerCredit).toBe(115);
  });

  it("throws on non-positive-integer credits", () => {
    expect(() => selectCreditTopUpTier(tiers, 0)).toThrow();
    expect(() => selectCreditTopUpTier(tiers, 1.5)).toThrow();
  });
});

describe("STANDARD_CREDIT_TOPUP_TIERS", () => {
  it("maps the three standard breakpoints to lookup keys in ascending order", () => {
    expect(STANDARD_CREDIT_TOPUP_TIERS.map((t) => t.minCredits)).toEqual([
      1, 10_000, 100_000,
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sokosumi/utils test credit-topup-pricing`
Expected: FAIL — `selectCreditTopUpTier` / `STANDARD_CREDIT_TOPUP_TIERS` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `packages/utils/src/credit-topup-pricing.ts`:

```typescript
export interface CreditTopUpTier {
  minCredits: number;
  amountPerCredit: number;
}

/**
 * Volume breakpoints for standard credit top-up pricing, mapped to their Stripe
 * lookup keys. Single source of truth for the tier curve — keep aligned with
 * {@link getCreditTopUpLookupKeyByCredits}. A tier applies from its `minCredits`
 * (inclusive) up to the next tier's `minCredits` (exclusive).
 */
export const STANDARD_CREDIT_TOPUP_TIERS: ReadonlyArray<{
  minCredits: number;
  lookupKey: StandardCreditTopUpLookupKey;
}> = [
  { minCredits: 1, lookupKey: BASE_CREDIT_TOPUP_LOOKUP_KEY },
  { minCredits: BASE_TIER_MAX_CREDITS, lookupKey: MID_CREDIT_TOPUP_LOOKUP_KEY },
  { minCredits: MID_TIER_MAX_CREDITS, lookupKey: HIGH_CREDIT_TOPUP_LOOKUP_KEY },
];

/**
 * Picks the tier whose `minCredits` is the greatest value not exceeding
 * `credits`. Margin-free: operates purely on opaque tiers, so the web app never
 * needs to know about lookup keys or margin levels.
 */
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

- [ ] **Step 4: Export from the package barrel**

In `packages/utils/src/index.ts`, ensure the new symbols are exported alongside the existing `credit-topup-pricing` exports. If that file uses an explicit export list, add `CreditTopUpTier`, `STANDARD_CREDIT_TOPUP_TIERS`, and `selectCreditTopUpTier`. (If it re-exports the module with `export * from "./credit-topup-pricing"`, no change is needed — verify with `grep -n "credit-topup-pricing" packages/utils/src/index.ts`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sokosumi/utils test credit-topup-pricing`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/credit-topup-pricing.ts packages/utils/src/index.ts packages/utils/src/__tests__/credit-topup-pricing.test.ts
git commit -m "feat(utils): add margin-free credit top-up tier helpers"
```

---

### Task 2: Core-only zero-margin eligibility module

**Files:**
- Create: `apps/core/src/lib/zero-margin-top-up.ts`
- Test: `apps/core/src/lib/__tests__/zero-margin-top-up.test.ts`

**Interfaces:**
- Produces:
  - `function resolveZeroMarginTopUpLookupKey(email: string | null | undefined): CreditTopUpLookupKey | undefined`
- Consumes: `ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY`, `CreditTopUpLookupKey` from `@sokosumi/utils`.

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/lib/__tests__/zero-margin-top-up.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { resolveZeroMarginTopUpLookupKey } from "../zero-margin-top-up";

describe("resolveZeroMarginTopUpLookupKey", () => {
  it("returns the zero-margin key for an allowlisted domain", () => {
    expect(resolveZeroMarginTopUpLookupKey("alice@nmkr.io")).toBe(
      "credit_0_margin",
    );
  });

  it("is case-insensitive on the domain", () => {
    expect(resolveZeroMarginTopUpLookupKey("alice@NMKR.IO")).toBe(
      "credit_0_margin",
    );
  });

  it("returns undefined for a non-allowlisted domain", () => {
    expect(
      resolveZeroMarginTopUpLookupKey("bob@example.com"),
    ).toBeUndefined();
  });

  it("returns undefined for null/empty/invalid email", () => {
    expect(resolveZeroMarginTopUpLookupKey(null)).toBeUndefined();
    expect(resolveZeroMarginTopUpLookupKey(undefined)).toBeUndefined();
    expect(resolveZeroMarginTopUpLookupKey("")).toBeUndefined();
    expect(resolveZeroMarginTopUpLookupKey("not-an-email")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sokosumi/core test zero-margin-top-up`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module (move the allowlist from web)**

Create `apps/core/src/lib/zero-margin-top-up.ts`. Copy the `ZERO_MARGIN_TOP_UP_DOMAINS` set **verbatim** from `apps/web/src/lib/flags/zero-margin-top-up.ts` (the `new Set([...])` literal, currently lines 11–114). The rest of the file:

```typescript
import {
  type CreditTopUpLookupKey,
  ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY,
} from "@sokosumi/utils";

// NOTE: allowlist copied verbatim from the former web flag
// (apps/web/src/lib/flags/zero-margin-top-up.ts). Core is now the sole owner;
// this list must never reach a browser bundle.
const ZERO_MARGIN_TOP_UP_DOMAINS = new Set([
  // ...paste the exact domain string literals from the web file here...
]);

function getEmailDomain(email: string): string | null {
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0 || atIndex === email.length - 1) {
    return null;
  }
  return email.slice(atIndex + 1).toLowerCase();
}

function isZeroMarginTopUpDomain(email: string): boolean {
  const domain = getEmailDomain(email);
  return domain !== null && ZERO_MARGIN_TOP_UP_DOMAINS.has(domain);
}

/**
 * Resolves whether the given user email is entitled to zero-margin credit
 * pricing. Authoritative server-side gate — the web app never sees this list
 * and cannot influence the result.
 */
export function resolveZeroMarginTopUpLookupKey(
  email: string | null | undefined,
): CreditTopUpLookupKey | undefined {
  if (!email || !isZeroMarginTopUpDomain(email)) {
    return undefined;
  }
  return ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sokosumi/core test zero-margin-top-up`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/lib/zero-margin-top-up.ts apps/core/src/lib/__tests__/zero-margin-top-up.test.ts
git commit -m "feat(core): add server-side zero-margin eligibility module"
```

---

### Task 3: Reshape the Core billing schemas

**Files:**
- Modify: `apps/core/src/schemas/billing.schema.ts`

**Interfaces:**
- Produces:
  - `creditTopUpTierSchema` → `CreditTopUpTier` (`{ minCredits: number; amountPerCredit: number }`)
  - `creditTopUpPricingSchema` → `CreditTopUpPricing` (`{ currency: string; tiers: CreditTopUpTier[]; referenceAmountPerCredit: number; canPurchaseOnFreePlan: boolean }`)
  - `createCreditCheckoutSessionSchema` with NO `priceLookupKeyOverride`
- Removes: `creditTopUpPriceCatalogSchema`, `creditTopUpCatalogQuerySchema`.

- [ ] **Step 1: Add the new pricing schemas**

In `apps/core/src/schemas/billing.schema.ts`, add after `creditTopUpPriceSchema`:

```typescript
export const creditTopUpTierSchema = z
  .object({
    minCredits: z.number().int().positive().openapi({ example: 1 }),
    amountPerCredit: z.number().openapi({ example: 120 }),
  })
  .openapi("CreditTopUpTier");

export const creditTopUpPricingSchema = z
  .object({
    currency: z.string().openapi({ example: "eur" }),
    tiers: z
      .array(creditTopUpTierSchema)
      .openapi({ example: [{ minCredits: 1, amountPerCredit: 120 }] }),
    referenceAmountPerCredit: z.number().openapi({ example: 120 }),
    canPurchaseOnFreePlan: z.boolean().openapi({ example: false }),
  })
  .openapi("CreditTopUpPricing");

export type CreditTopUpPricing = z.infer<typeof creditTopUpPricingSchema>;
```

- [ ] **Step 2: Remove the old catalog + query schemas and the override field**

Delete these from the file:
- `creditTopUpPriceCatalogSchema` (the `z.record(...)` block).
- `creditTopUpCatalogQuerySchema` (the `extraLookupKeys` block).
- The `priceLookupKeyOverride: creditTopUpLookupKeySchema.optional(),` line inside `createCreditCheckoutSessionSchema`.

- [ ] **Step 3: Clean up now-unused imports/exports**

Run: `grep -rn "creditTopUpPriceCatalogSchema\|creditTopUpCatalogQuerySchema\|creditTopUpLookupKeySchema" apps/core/src`
- Remove any import line that is now unused. `creditTopUpLookupKeySchema` is only used by the catalog route (removed in Task 5) and the deleted override field; if grep shows no other consumer after Task 5, delete it too. For now, keep `creditTopUpLookupKeySchema` and the `CREDIT_TOPUP_LOOKUP_KEYS`/`ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY` imports — they are removed in Task 5's cleanup once routes stop using them.

- [ ] **Step 4: Verify the package still type-checks**

Run: `pnpm --filter @sokosumi/core exec tsc --noEmit`
Expected: errors ONLY in `routes/v1/products/credits/catalog/get.ts` and `routes/v1/checkout/credits/post.ts` and `services/stripe-billing.service.ts` (fixed in Tasks 4–5). No errors in the schema file itself.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/schemas/billing.schema.ts
git commit -m "feat(core): replace credit catalog schema with margin-free pricing schema"
```

---

### Task 4: Core service — server-side pricing authority

**Files:**
- Modify: `apps/core/src/services/stripe-billing.service.ts`
- Test: `apps/core/src/services/__tests__/stripe-billing.service.test.ts` (new)

**Interfaces:**
- Consumes: `resolveZeroMarginTopUpLookupKey` (Task 2); `STANDARD_CREDIT_TOPUP_TIERS` (Task 1); `CreditTopUpPricing` (Task 3); `stripeClient.getPriceByLookupKey`, `stripeClient.getCreditTopUpPriceByCredits`, `stripeClient.createCreditCheckoutSession` (existing).
- Produces:
  - `stripeBillingService.getCreditTopUpPricing(userId: string): Promise<CreditTopUpPricing>` (replaces `getCreditTopUpPriceCatalog`)
  - `createCreditCheckoutSession` no longer accepts `priceLookupKeyOverride`.

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/services/__tests__/stripe-billing.service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const getPriceByLookupKeyMock = vi.fn();
const getCreditTopUpPriceByCreditsMock = vi.fn();
const createCreditCheckoutSessionMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    organization: { findUnique: vi.fn() },
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    getPriceByLookupKey: (...args: unknown[]) =>
      getPriceByLookupKeyMock(...args),
    getCreditTopUpPriceByCredits: (...args: unknown[]) =>
      getCreditTopUpPriceByCreditsMock(...args),
    createCreditCheckoutSession: (...args: unknown[]) =>
      createCreditCheckoutSessionMock(...args),
  },
}));

import { stripeBillingService } from "../stripe-billing.service";

const PRICE = (amountPerCredit: number) => ({
  id: `price_${amountPerCredit}`,
  amountPerCredit,
  currency: "eur",
});

beforeEach(() => {
  vi.clearAllMocks();
  // Standard prices keyed by lookup key.
  getPriceByLookupKeyMock.mockImplementation(async (lookupKey: string) => {
    const map: Record<string, number> = {
      credit_20_margin: 120,
      credit_15_margin: 115,
      credit_10_margin: 110,
      credit_0_margin: 100,
    };
    return PRICE(map[lookupKey]);
  });
});

describe("getCreditTopUpPricing", () => {
  it("returns the three standard tiers for a non-allowlisted user", async () => {
    findUniqueMock.mockResolvedValue({ email: "bob@example.com" });

    const pricing = await stripeBillingService.getCreditTopUpPricing("user_1");

    expect(pricing.canPurchaseOnFreePlan).toBe(false);
    expect(pricing.currency).toBe("eur");
    expect(pricing.tiers).toEqual([
      { minCredits: 1, amountPerCredit: 120 },
      { minCredits: 10_000, amountPerCredit: 115 },
      { minCredits: 100_000, amountPerCredit: 110 },
    ]);
    expect(pricing.referenceAmountPerCredit).toBe(120);
  });

  it("returns a single zero-margin tier for an allowlisted user", async () => {
    findUniqueMock.mockResolvedValue({ email: "alice@nmkr.io" });

    const pricing = await stripeBillingService.getCreditTopUpPricing("user_2");

    expect(pricing.canPurchaseOnFreePlan).toBe(true);
    expect(pricing.tiers).toEqual([{ minCredits: 1, amountPerCredit: 100 }]);
    expect(pricing.referenceAmountPerCredit).toBe(100);
  });
});

describe("createCreditCheckoutSession pricing authority", () => {
  beforeEach(() => {
    findUniqueMock.mockResolvedValue({
      email: "bob@example.com",
      stripeCustomerId: "cus_123",
    });
    getCreditTopUpPriceByCreditsMock.mockResolvedValue(PRICE(120));
    createCreditCheckoutSessionMock.mockResolvedValue({
      url: "https://checkout.stripe.com/x",
    });
  });

  it("prices a non-allowlisted user from the volume curve (no zero-margin key)", async () => {
    await stripeBillingService.createCreditCheckoutSession({
      userId: "user_1",
      organizationId: null,
      credits: 5_000,
    });

    expect(getCreditTopUpPriceByCreditsMock).toHaveBeenCalledWith(
      5_000,
      undefined,
    );
  });

  it("prices an allowlisted user with the zero-margin key, regardless of input", async () => {
    findUniqueMock.mockResolvedValue({
      email: "alice@nmkr.io",
      stripeCustomerId: "cus_123",
    });

    await stripeBillingService.createCreditCheckoutSession({
      userId: "user_2",
      organizationId: null,
      credits: 5_000,
    });

    expect(getCreditTopUpPriceByCreditsMock).toHaveBeenCalledWith(
      5_000,
      "credit_0_margin",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sokosumi/core test stripe-billing.service`
Expected: FAIL — `getCreditTopUpPricing` does not exist; checkout still takes an override.

- [ ] **Step 3: Implement the service changes**

In `apps/core/src/services/stripe-billing.service.ts`:

Update imports at the top:

```typescript
import {
  type CreditTopUpLookupKey,
  getOrganizationMetadata,
  STANDARD_CREDIT_TOPUP_TIERS,
} from "@sokosumi/utils";
import type Stripe from "stripe";

import { type CreditPrice, stripeClient } from "@/clients/stripe.client";
import { badRequest, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { resolveZeroMarginTopUpLookupKey } from "@/lib/zero-margin-top-up";
import type { CreditTopUpPricing } from "@/schemas/billing.schema";
import type { SubscriptionCatalog } from "@/services/subscription-catalog.service";
import { getSubscriptionCatalog } from "@/services/subscription-catalog.service";
```

Add a private helper near `ensureStripeCustomerId`:

```typescript
async function resolveZeroMarginLookupKeyForUser(
  userId: string,
): Promise<CreditTopUpLookupKey | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return resolveZeroMarginTopUpLookupKey(user?.email);
}
```

Replace the `getCreditTopUpPriceCatalog` method with:

```typescript
  async getCreditTopUpPricing(userId: string): Promise<CreditTopUpPricing> {
    const zeroMarginLookupKey =
      await resolveZeroMarginLookupKeyForUser(userId);

    if (zeroMarginLookupKey) {
      const price = await stripeClient.getPriceByLookupKey(zeroMarginLookupKey);
      return {
        currency: price.currency,
        tiers: [{ minCredits: 1, amountPerCredit: price.amountPerCredit }],
        referenceAmountPerCredit: price.amountPerCredit,
        canPurchaseOnFreePlan: true,
      };
    }

    const pricedTiers = await Promise.all(
      STANDARD_CREDIT_TOPUP_TIERS.map(async (tier) => {
        const price = await stripeClient.getPriceByLookupKey(tier.lookupKey);
        return {
          minCredits: tier.minCredits,
          amountPerCredit: price.amountPerCredit,
          currency: price.currency,
        };
      }),
    );

    const [baseTier] = pricedTiers;
    if (!baseTier) {
      throw badRequest("No credit top-up tiers configured");
    }

    return {
      currency: baseTier.currency,
      tiers: pricedTiers.map(({ minCredits, amountPerCredit }) => ({
        minCredits,
        amountPerCredit,
      })),
      // Base (smallest-volume) tier is the most expensive per credit; it is the
      // reference against which higher-volume savings are displayed.
      referenceAmountPerCredit: baseTier.amountPerCredit,
      canPurchaseOnFreePlan: false,
    };
  },
```

Change `createCreditCheckoutSession`: drop `priceLookupKeyOverride` from the params type, and replace the price-resolution block:

```typescript
  async createCreditCheckoutSession(params: {
    userId: string;
    organizationId: string | null;
    credits: number;
    returnPath?: string;
    promotionCodeId?: string | null;
    origin?: string | null;
    ttlDays?: string;
  }): Promise<{ url: string }> {
    const stripeCustomerId = await ensureStripeCustomerId(
      params.userId,
      params.organizationId,
    );
    // Pricing curve is resolved server-side from the authenticated user — the
    // client cannot supply a lookup-key override.
    const zeroMarginLookupKey = await resolveZeroMarginLookupKeyForUser(
      params.userId,
    );
    const price = await stripeClient.getCreditTopUpPriceByCredits(
      params.credits,
      zeroMarginLookupKey,
    );

    const session = await stripeClient.createCreditCheckoutSession({
      stripeCustomerId,
      userId: params.userId,
      organizationId: params.organizationId,
      credits: params.credits,
      price,
      origin: params.origin,
      promotionCodeId: params.promotionCodeId,
      returnPath: params.returnPath,
      ttlDays: params.ttlDays,
    });

    if (!session.url) {
      throw badRequest("Failed to create checkout session");
    }

    return { url: session.url };
  },
```

Remove the now-unused `CreditPrice` import only if nothing else in the file uses it (grep first — `ensureStripeCustomerId` and others may not; `getCreditTopUpPriceCatalog` was the consumer). Keep it if still referenced.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sokosumi/core test stripe-billing.service`
Expected: PASS — including the regression test proving an allowlisted user is priced with `credit_0_margin` and a normal user is never priced with it, driven solely by email.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/services/stripe-billing.service.ts apps/core/src/services/__tests__/stripe-billing.service.test.ts
git commit -m "feat(core): resolve credit pricing server-side from the authenticated user"
```

---

### Task 5: Update the Core route handlers

**Files:**
- Modify: `apps/core/src/routes/v1/products/credits/catalog/get.ts`
- Modify: `apps/core/src/routes/v1/checkout/credits/post.ts`

**Interfaces:**
- Consumes: `stripeBillingService.getCreditTopUpPricing(userId)`, `creditTopUpPricingSchema`, `createCreditCheckoutSessionSchema` (no override).

- [ ] **Step 1: Rewrite the catalog handler**

Replace `apps/core/src/routes/v1/products/credits/catalog/get.ts` with:

```typescript
import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { creditTopUpPricingSchema } from "@/schemas/billing.schema";
import { stripeBillingService } from "@/services/stripe-billing.service";

const route = createRoute({
  method: "get",
  path: "/credits/catalog",
  operationId: "getCreditTopUpPriceCatalog",
  description:
    "Account-resolved credit top-up pricing for the authenticated user. Pricing tiers and zero-margin eligibility are determined server-side; no request input influences pricing.",
  tags: ["Products"],
  responses: {
    200: jsonSuccessResponse(
      creditTopUpPricingSchema,
      "Account-resolved credit top-up pricing",
      {
        data: {
          currency: "eur",
          tiers: [
            { minCredits: 1, amountPerCredit: 120 },
            { minCredits: 10000, amountPerCredit: 115 },
            { minCredits: 100000, amountPerCredit: 110 },
          ],
          referenceAmountPerCredit: 120,
          canPurchaseOnFreePlan: false,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);

    const pricing = await stripeBillingService.getCreditTopUpPricing(
      userContext.userId,
    );

    return ok(c, creditTopUpPricingSchema.parse(pricing));
  });
}
```

- [ ] **Step 2: Update the checkout handler**

In `apps/core/src/routes/v1/checkout/credits/post.ts`, remove the `priceLookupKeyOverride: body.priceLookupKeyOverride,` line from the `createCreditCheckoutSession` call (lines around 75–84). Leave everything else (org membership check, etc.) unchanged.

- [ ] **Step 3: Final schema cleanup**

Run: `grep -rn "creditTopUpLookupKeySchema\|creditTopUpPriceCatalogSchema\|creditTopUpCatalogQuerySchema" apps/core/src`
- If `creditTopUpLookupKeySchema` now has no consumers, remove it from `billing.schema.ts` along with the now-unused `CREDIT_TOPUP_LOOKUP_KEYS` / `ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY` / `CreditTopUpLookupKey` imports there. Keep `creditTopUpPriceSchema`/`CreditTopUpPrice` only if still referenced (grep).

- [ ] **Step 4: Type-check + run the v1 index test**

Run: `pnpm --filter @sokosumi/core exec tsc --noEmit`
Expected: PASS (no errors).
Run: `pnpm --filter @sokosumi/core test src/routes/v1/index.test.ts`
Expected: PASS (router still mounts).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/routes/v1/products/credits/catalog/get.ts apps/core/src/routes/v1/checkout/credits/post.ts apps/core/src/schemas/billing.schema.ts
git commit -m "feat(core): drop client-supplied pricing inputs from credit endpoints"
```

---

### Task 6: Regenerate the web Core API client

**Files:**
- Modify (generated, do not hand-edit): `apps/web/src/lib/clients/generated/core/*`

- [ ] **Step 1: Regenerate from the Core OpenAPI snapshot**

Run: `pnpm --filter web generate:core:snapshot`

- [ ] **Step 2: Verify the new shape landed**

Run: `grep -n "CreditTopUpPricing\|canPurchaseOnFreePlan\|referenceAmountPerCredit" apps/web/src/lib/clients/generated/core/types.gen.ts`
Expected: the new `CreditTopUpPricing` type with `tiers`, `referenceAmountPerCredit`, `canPurchaseOnFreePlan`.
Run: `grep -n "priceLookupKeyOverride\|extraLookupKeys" apps/web/src/lib/clients/generated/core/`
Expected: no matches (the checkout body and catalog query no longer carry them).

- [ ] **Step 3: Commit the regenerated client as-is**

```bash
git add apps/web/src/lib/clients/generated/core
git commit -m "chore(web): regenerate core client for margin-free credit pricing"
```

---

### Task 7: Web client wrappers + margin-free credits form

**Files:**
- Modify: `apps/web/src/lib/clients/core.shared.ts`
- Modify: `apps/web/src/components/credits/credits-form.tsx`

**Interfaces:**
- Consumes: generated `CreditTopUpPricing`; `selectCreditTopUpTier`, `getCreditTopUpTotalMinorUnits`, `isPositiveIntegerCredits` from `@sokosumi/utils`.

- [ ] **Step 1: Update the client wrappers**

In `apps/web/src/lib/clients/core.shared.ts`:
- Replace `getCreditTopUpPriceCatalog` (around line 657):

```typescript
  async function getCreditTopUpPriceCatalog() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetCreditTopUpPriceCatalog({
          client,
          cache: "no-store",
        }),
      "Failed to fetch credit top-up price catalog",
    );
  }
```

- In `createCreditCheckoutSession` (around line 681), remove `priceLookupKeyOverride?: CreditTopUpLookupKey;` from the `body` parameter type.
- Remove the now-unused `CreditTopUpLookupKey` import if grep shows no other use in this file: `grep -n "CreditTopUpLookupKey" apps/web/src/lib/clients/core.shared.ts`.

- [ ] **Step 2: Rewrite the pricing summary + props in credits-form**

In `apps/web/src/components/credits/credits-form.tsx`:

Replace the `@sokosumi/utils` import block (lines ~4–10) with:

```typescript
import {
  getCreditTopUpTotalMinorUnits,
  isPositiveIntegerCredits,
  selectCreditTopUpTier,
} from "@sokosumi/utils";
```

Replace the generated-types import (lines ~41–45) with:

```typescript
import type {
  CreditTopUpPricing,
  Organization,
} from "@/lib/clients/generated/core";
```

Replace the `CreditPricingSummary` interface and `getCreditPricingSummary` function (lines ~52–101) with:

```typescript
interface CreditPricingSummary {
  amountPerCredit: number;
  currency: string;
  hasDiscountComparison: boolean;
  referenceTotalMinorUnits: number;
  savingsMinorUnits: number | null;
  totalMinorUnits: number;
}

function getCreditPricingSummary(
  credits: number,
  pricing: CreditTopUpPricing,
): CreditPricingSummary {
  const tier = selectCreditTopUpTier(pricing.tiers, credits);
  const totalMinorUnits = getCreditTopUpTotalMinorUnits(
    credits,
    tier.amountPerCredit,
  );
  const referenceTotalMinorUnits = getCreditTopUpTotalMinorUnits(
    credits,
    pricing.referenceAmountPerCredit,
  );
  const hasDiscountComparison = referenceTotalMinorUnits > totalMinorUnits;

  return {
    amountPerCredit: tier.amountPerCredit,
    currency: pricing.currency,
    hasDiscountComparison,
    referenceTotalMinorUnits,
    savingsMinorUnits: hasDiscountComparison
      ? referenceTotalMinorUnits - totalMinorUnits
      : null,
    totalMinorUnits,
  };
}
```

Update `CreditsFormProps` (lines ~124–131): rename `priceCatalog: CreditTopUpPriceCatalog;` to `pricing: CreditTopUpPricing;` and delete `priceLookupKeyOverride?: CreditTopUpLookupKey;`. Update the destructure in the component signature accordingly (`pricing` instead of `priceCatalog`, drop `priceLookupKeyOverride`).

- [ ] **Step 3: Update the call sites + JSX field references in credits-form**

Within `credits-form.tsx`, apply these mechanical replacements:
- `getCreditPricingSummary(amount, priceCatalog, priceLookupKeyOverride)` → `getCreditPricingSummary(amount, pricing)` (quick-amount loop).
- `getCreditPricingSummary(selectedCredits, priceCatalog, priceLookupKeyOverride)` → `getCreditPricingSummary(selectedCredits, pricing)`.
- `pricing.price.amountPerCredit` → `pricing.amountPerCredit`.
- `pricing.price.currency` → `pricing.currency` (every occurrence).
- `pricing.baseTierTotalMinorUnits` → `pricing.referenceTotalMinorUnits`.
- `selectedPricing.price.currency` → `selectedPricing.currency`.
- Delete `const selectedPrice = selectedPricing?.price ?? null;` and replace the footer guard `selectedPrice ? (` with `selectedPricing !== null ? (` (use the existing `selectedPricing` non-null check).

Note: the per-amount loop variable is also named `pricing` (the result of `getCreditPricingSummary`). After this edit it correctly carries `amountPerCredit`/`currency`/`savingsMinorUnits`/`referenceTotalMinorUnits` — no `.price` member.

- [ ] **Step 4: Type-check the web app**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: errors only in `credits-section.tsx` and `billing/page.tsx` (fixed in Task 8) and tests (Task 9). No errors inside `credits-form.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/clients/core.shared.ts apps/web/src/components/credits/credits-form.tsx
git commit -m "refactor(web): compute credit prices from opaque margin-free pricing"
```

---

### Task 8: Web — credits-section, billing page, action; delete the flag

**Files:**
- Modify: `apps/web/src/components/billing/credits-section.tsx`
- Modify: `apps/web/src/app/(app)/billing/page.tsx`
- Modify: `apps/web/src/lib/actions/credits/action.ts`
- Delete: `apps/web/src/lib/flags/zero-margin-top-up.ts`

- [ ] **Step 1: Update credits-section**

In `apps/web/src/components/billing/credits-section.tsx`:
- Delete the `import type { CreditTopUpLookupKey } from "@sokosumi/utils";` line.
- Remove `priceLookupKeyOverride?: CreditTopUpLookupKey;` from `CreditsSectionProps` and the destructure.
- Replace the catalog fetch + form usage:

```typescript
  const { data: pricing } = await coreClient.getCreditTopUpPriceCatalog();
```

```tsx
      <CreditsForm
        isPurchaseEnabled={isPurchaseEnabled}
        pricing={pricing}
        organization={organization}
        returnPath={returnPath}
      />
```

- [ ] **Step 2: Update the billing page**

In `apps/web/src/app/(app)/billing/page.tsx`:
- Delete the `import { zeroMarginTopUpEnabled } from "@/lib/flags/zero-margin-top-up";` line and the `ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY` import.
- Remove `zeroMarginTopUpEnabled()` from the `Promise.all` (and the `isZeroMarginTopUpEnabled` binding).
- Delete the `creditsPriceLookupKeyOverride` declaration.
- Fetch the credit pricing once at page level and derive eligibility. Add to the page's data loading (near the existing `coreClient.getSubscriptionCatalog()` call):

```typescript
    const creditPricing = await coreClient
      .getCreditTopUpPriceCatalog()
      .then((response) => response.data);
    const canPurchaseOnFreePlan = creditPricing.canPurchaseOnFreePlan;
```

- Replace every `isZeroMarginTopUpEnabled` usage with `canPurchaseOnFreePlan`. Specifically:

```typescript
    const canPurchaseCredits =
      isOwnerOrAdmin && (currentPlan !== "free" || canPurchaseOnFreePlan);
```

- Remove the two `priceLookupKeyOverride={creditsPriceLookupKeyOverride}` props passed to `<CreditsSection />` (lines ~251 and ~356). `CreditsSection` fetches its own pricing now, so no prop is needed.

(If the personal/non-org branch of the page also referenced `isZeroMarginTopUpEnabled`, apply the same `canPurchaseOnFreePlan` substitution there. Grep within the file to confirm all occurrences are replaced: `grep -n "isZeroMarginTopUpEnabled\|creditsPriceLookupKeyOverride\|zeroMargin" apps/web/src/app/\(app\)/billing/page.tsx` → expect no matches after edits.)

- [ ] **Step 3: Update the purchase-credits action**

In `apps/web/src/lib/actions/credits/action.ts`:
- Delete `import { resolveZeroMarginTopUpLookupKey } from "@/lib/flags/zero-margin-top-up";`.
- In `purchaseCredits`, remove the `priceLookupKeyOverride` resolution and argument:

```typescript
    const headerList = await headers();
    const { data } = await coreClient.createCreditCheckoutSession({
      organizationId,
      credits,
      returnPath,
      origin: headerList.get("origin") ?? undefined,
    });
```

`session` is still destructured from the params but no longer used for pricing — if it becomes unused, rename it to `_session` (Biome) or drop it from the destructure. Grep to confirm: `grep -n "session" apps/web/src/lib/actions/credits/action.ts`.

- [ ] **Step 4: Delete the web flag module**

Run: `git rm apps/web/src/lib/flags/zero-margin-top-up.ts`

- [ ] **Step 5: Confirm no remaining web references**

Run: `grep -rn "margin\|LookupKey\|priceLookupKeyOverride\|extraLookupKeys\|zeroMargin" apps/web/src --include=*.ts --include=*.tsx | grep -v "/generated/" | grep -v "/__tests__/"`
Expected: no matches. (`getEmailDomain` in `apps/web/src/lib/utils/email.ts` stays — still used by `apps/web/src/lib/hermes/beta-access.ts`.)

- [ ] **Step 6: Type-check**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: errors only in test files (fixed in Task 9).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/billing/credits-section.tsx "apps/web/src/app/(app)/billing/page.tsx" apps/web/src/lib/actions/credits/action.ts
git commit -m "feat(web): consume margin-free credit pricing from core"
```

---

### Task 9: Update web tests

**Files:**
- Modify: `apps/web/src/components/credits/__tests__/credits-form.test.tsx`
- Modify: `apps/web/src/app/(app)/billing/__tests__/page.test.tsx`
- Modify: `apps/web/src/lib/actions/credits/__tests__/action.test.ts`
- Modify: `apps/web/src/app/(app)/components/__tests__/onboarding-dialog-loader.test.tsx` (only if it referenced the flag/override — grep first)

- [ ] **Step 1: Update the credits-form test fixture**

In `apps/web/src/components/credits/__tests__/credits-form.test.tsx`:
- Replace the `CreditTopUpPriceCatalog` import and `priceCatalog` fixture with the new `CreditTopUpPricing` shape:

```typescript
import type { CreditTopUpPricing } from "@/lib/clients/generated/core";

const pricing: CreditTopUpPricing = {
  currency: "eur",
  tiers: [
    { minCredits: 1, amountPerCredit: 120 },
    { minCredits: 10_000, amountPerCredit: 115 },
    { minCredits: 100_000, amountPerCredit: 110 },
  ],
  referenceAmountPerCredit: 120,
  canPurchaseOnFreePlan: false,
};
```

- Replace every `priceCatalog={priceCatalog}` render prop with `pricing={pricing}`, and drop any `priceLookupKeyOverride` prop. Adjust assertions that referenced specific catalog keys to use the tier-derived totals (the formatter mock renders `${currency}:${value}` so totals like `5000 * 120 / 100 = 6000` → `EUR:6000.00`).

- [ ] **Step 2: Run the credits-form test**

Run: `pnpm --filter web test credits-form`
Expected: PASS.

- [ ] **Step 3: Update the billing page test**

In `apps/web/src/app/(app)/billing/__tests__/page.test.tsx`:
- Remove the `vi.mock("@/lib/flags/zero-margin-top-up", ...)` block and the `zeroMarginTopUpEnabledMock`.
- Add a mock for the new catalog call on the core client mock (alongside `getSubscriptionCatalogMock`): `getCreditTopUpPriceCatalogMock.mockResolvedValue({ data: { currency: "eur", tiers: [{ minCredits: 1, amountPerCredit: 120 }], referenceAmountPerCredit: 120, canPurchaseOnFreePlan: false } });` — wire it into the `vi.mock("@/lib/clients/core.client", ...)` factory as `getCreditTopUpPriceCatalog: (...args) => getCreditTopUpPriceCatalogMock(...args)`.
- For any test that previously asserted free-plan purchase via `zeroMarginTopUpEnabledMock.mockReturnValue(true)`, switch to `getCreditTopUpPriceCatalogMock.mockResolvedValue({ data: { ...canPurchaseOnFreePlan: true } })`.

- [ ] **Step 4: Run the billing page test**

Run: `pnpm --filter web test "billing/__tests__/page"`
Expected: PASS.

- [ ] **Step 5: Update the credits action test**

In `apps/web/src/lib/actions/credits/__tests__/action.test.ts`:
- Remove any mock of `@/lib/flags/zero-margin-top-up` and assertions that `createCreditCheckoutSession` was called with `priceLookupKeyOverride`.
- Update the expected `createCreditCheckoutSession` call args to the new shape (`organizationId`, `credits`, `returnPath`, `origin`) without the override.

- [ ] **Step 6: Run the action test**

Run: `pnpm --filter web test "actions/credits"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/credits/__tests__/credits-form.test.tsx "apps/web/src/app/(app)/billing/__tests__/page.test.tsx" apps/web/src/lib/actions/credits/__tests__/action.test.ts
git commit -m "test(web): update credit pricing tests for margin-free contract"
```

---

### Task 10: Full verification

- [ ] **Step 1: Lint + format**

Run: `pnpm check`
Expected: PASS (no lint/format/import-organization errors). If formatting changed files, run `pnpm format`, then re-stage and amend the relevant commit.

- [ ] **Step 2: Run the affected test suites**

Run: `pnpm --filter @sokosumi/utils test`
Run: `pnpm --filter @sokosumi/core test`
Run: `pnpm --filter web test`
Expected: all PASS.

- [ ] **Step 3: Margin-leak grep gate**

Run: `grep -rn "margin\|LookupKey\|priceLookupKeyOverride\|extraLookupKeys\|zeroMargin" apps/web/src --include=*.ts --include=*.tsx | grep -v "/generated/"`
Expected: no matches.

- [ ] **Step 4: Confirm the security regression is covered**

Confirm `apps/core/src/services/__tests__/stripe-billing.service.test.ts` contains the test proving an allowlisted user is priced with `credit_0_margin` and a non-allowlisted user never is, driven only by the resolved email — and that `createCreditCheckoutSession` accepts no client pricing field.

- [ ] **Step 5: Final commit (if any formatting/cleanup remains)**

```bash
git add -A
git commit -m "chore: final cleanup for credit pricing core authority" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Core sole authority + drop client override → Tasks 4, 5 (+ regression test).
- Web margin-agnostic / opaque structure → Tasks 1, 3, 6, 7, 8 (+ grep gate Task 10).
- Allowlist moved Core-only → Task 2; web flag deleted → Task 8.
- `canPurchaseOnFreePlan` for the free-plan gate → Tasks 3, 4, 8.
- Preserve UX without round-trips → Task 7 (client-side compute from opaque tiers).
- Tests (Core regression + web updates) → Tasks 4, 9.
- Audit onboarding/purchase-tracker → confirmed no margin refs at design time; grep gate (Task 10 Step 3) re-confirms.

**Type consistency:** `getCreditTopUpPricing(userId)` returns `CreditTopUpPricing` (Task 3) consumed in Tasks 5/7/8; `selectCreditTopUpTier`/`STANDARD_CREDIT_TOPUP_TIERS`/`CreditTopUpTier` defined in Task 1, used in Tasks 4/7; `resolveZeroMarginTopUpLookupKey` defined in Task 2, used in Task 4. Names align.

**Placeholders:** The only deferred content is the ~100-domain allowlist (Task 2 Step 3), which is a verbatim move from an exact cited source range, and a handful of grep-then-remove cleanups for unused imports — both intentional, not unspecified work.
