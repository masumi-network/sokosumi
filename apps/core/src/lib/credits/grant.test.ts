import type { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  grantFreeCredits: vi.fn(),
  grantSignupBonusCredits: vi.fn(),
  wake: vi.fn(),
}));
vi.mock("@sokosumi/database/helpers", () => ({
  grantFreeCredits: database.grantFreeCredits,
  grantSignupBonusCredits: database.grantSignupBonusCredits,
}));
vi.mock("@/services/task-topup.service", () => ({
  markOutOfCreditsTasksAsToppedUp: database.wake,
}));

import type { NetworkScope } from "@/lib/db/network-scope";

import {
  type GrantRequest,
  type GrantResult,
  grant,
  type LocalFreePeriodGrant,
  type PolarGrant,
  type StripeInvoiceGrant,
} from "./grant";

const scope = { network: "mainnet" } as NetworkScope;
const tx = {} as Prisma.TransactionClient;
const signupBonus = {
  scope,
  tx,
  kind: "signup_bonus" as const,
  userId: "user-1",
  credits: 3000,
  expiresAt: null,
};

describe("grant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wakes nothing for a grant that was already given, even when asked to wake", async () => {
    database.grantSignupBonusCredits.mockResolvedValueOnce({
      bucketId: "bucket-1",
      created: false,
    });

    await expect(grant({ ...signupBonus, wakeTasks: true })).resolves.toEqual({
      outcome: "already_granted",
      bucketId: "bucket-1",
    });
    expect(database.wake).not.toHaveBeenCalled();
  });

  it("wakes the owner's Tasks once after a new grant, on the caller's transaction", async () => {
    database.grantFreeCredits.mockResolvedValueOnce({ bucketId: "bucket-2" });

    await grant({
      scope,
      tx,
      kind: "cmo_tester",
      target: { targetType: "organization", organizationId: "org-1" },
      projectId: "project-1",
      credits: 10,
      expiresAt: null,
      grantId: "grant-1",
      note: null,
      wakeTasks: true,
    });

    expect(database.wake).toHaveBeenCalledExactlyOnceWith({
      organizationId: "org-1",
      projectId: "project-1",
      tx,
      userId: null,
    });
  });

  it("writes nothing for a scope that refuses its Network", async () => {
    const refusal = new Error("Preprod is off");
    const refused = {
      get network(): never {
        throw refusal;
      },
    } as unknown as NetworkScope;

    await expect(
      grant({ ...signupBonus, scope: refused, wakeTasks: true }),
    ).rejects.toBe(refusal);
    expect(database.grantSignupBonusCredits).not.toHaveBeenCalled();
  });
});

/**
 * Never called: `tsc` checks it. The later kinds' calls, as their writers
 * on `origin/main` take them, fit the contract; each `@ts-expect-error` is a
 * use that must not compile, so loosening a type fails the typecheck here.
 */
export function _laterGrantsFitTheContract(
  polarOutcome: GrantResult<"polar">,
  stripeOutcome: GrantResult<"stripe_invoice">,
  localFreeOutcome: GrantResult<"local_free_period">,
): void {
  const common = { scope, tx, wakeTasks: false };
  const polar = {
    ...common,
    kind: "polar",
    organizationId: "org-1",
    projectId: "project-1",
    cents: 10_000_000_000n,
    referenceId: "order-1:0",
    referenceType: "POLAR_SUBSCRIPTION_MONTH",
    note: "CMO plan",
    expiresAt: new Date(),
  } satisfies PolarGrant;
  const stripe = {
    ...common,
    kind: "stripe_invoice",
    owner: { organizationId: "org-1" },
    invoiceId: "in_1",
    entry: "topup",
    cents: 10_000_000_000n,
    referenceType: "STRIPE_TOPUP",
    expiresAt: null,
  } satisfies StripeInvoiceGrant;
  const localFree = {
    ...common,
    kind: "local_free_period",
    owner: { userId: "user-1" },
    credits: 250,
    periodEnd: new Date(),
    activatesAt: null,
  } satisfies LocalFreePeriodGrant;
  void ([polar, stripe, localFree] satisfies GrantRequest[]);

  // A keyed grant that was there is a success; these writers read no bucket.
  if (stripeOutcome.outcome === "already_granted") void stripeOutcome;
  if (localFreeOutcome.outcome === "granted") void localFreeOutcome;
  const noBucket: null = polarOutcome.bucketId;
  void noBucket;
  // @ts-expect-error a repeated Polar grant fails on its key in the caller's transaction, not here
  if (polarOutcome.outcome === "already_granted") void polarOutcome;

  // @ts-expect-error an amount is in credits or in cents, never both
  void ({ ...localFree, cents: 1n } satisfies LocalFreePeriodGrant);
  // @ts-expect-error nor cents with credits
  void ({ ...polar, credits: 1 } satisfies PolarGrant);
  // @ts-expect-error Polar's writer is handed cents
  void ({ ...polar, cents: 1 } satisfies PolarGrant);
  // @ts-expect-error `grant` takes the later kinds with the pull requests that move their writers
  void grant(polar);
}
