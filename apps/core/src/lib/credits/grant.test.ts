import type { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  createEnterprisePeriodCreditBucket: vi.fn(),
  createEnterpriseTopUpCreditBucket: vi.fn(),
  expireCreditBucketsNow: vi.fn(),
  grantFreeCredits: vi.fn(),
  grantLocalFreePeriodCredits: vi.fn(),
  grantSignupBonusCredits: vi.fn(),
  wake: vi.fn(),
}));
vi.mock("@sokosumi/database/helpers", async (original) => ({
  ...(await original<typeof import("@sokosumi/database/helpers")>()),
  createEnterprisePeriodCreditBucket:
    database.createEnterprisePeriodCreditBucket,
  createEnterpriseTopUpCreditBucket: database.createEnterpriseTopUpCreditBucket,
  expireCreditBucketsNow: database.expireCreditBucketsNow,
  grantFreeCredits: database.grantFreeCredits,
  grantLocalFreePeriodCredits: database.grantLocalFreePeriodCredits,
  grantSignupBonusCredits: database.grantSignupBonusCredits,
}));
vi.mock("@/services/task-topup.service", () => ({
  markOutOfCreditsTasksAsToppedUp: database.wake,
}));

import type { NetworkScope } from "@/lib/db/network-scope";

import {
  expireEnterpriseGrants,
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

  it("wakes nothing for a local free period that was already given, even when asked to wake", async () => {
    database.grantLocalFreePeriodCredits.mockResolvedValueOnce({
      created: false,
    });

    await expect(
      grant({
        scope,
        tx,
        kind: "local_free_period",
        owner: { organizationId: "org-1" },
        credits: 250,
        periodEnd: new Date("2026-12-01T00:00:00.000Z"),
        activatesAt: null,
        wakeTasks: true,
      }),
    ).resolves.toEqual({ outcome: "already_granted", bucketId: null });
    expect(database.wake).not.toHaveBeenCalled();
  });

  it("writes an enterprise top-up's cents as its amount and answers its bucket", async () => {
    database.createEnterpriseTopUpCreditBucket.mockResolvedValueOnce({
      bucketId: "bucket-3",
      created: true,
    });
    const activatesAt = new Date("2026-11-01T00:00:00.000Z");

    await expect(
      grant({
        scope,
        tx,
        kind: "enterprise_top_up",
        organizationId: "org-1",
        contractId: "contract-1",
        cents: 7n,
        activatesAt,
        expiresAt: null,
        wakeTasks: false,
      }),
    ).resolves.toEqual({ outcome: "granted", bucketId: "bucket-3" });
    expect(
      database.createEnterpriseTopUpCreditBucket,
    ).toHaveBeenCalledExactlyOnceWith(
      {
        activatesAt,
        amount: 7n,
        contractId: "contract-1",
        expiresAt: null,
        organizationId: "org-1",
      },
      tx,
    );
    expect(database.createEnterprisePeriodCreditBucket).not.toHaveBeenCalled();
    expect(database.wake).not.toHaveBeenCalled();
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

  it.each([false, true])(
    "Stripe grant with an existing reference = %s",
    async (existing) => {
      const findUnique = vi
        .fn()
        .mockResolvedValue(existing ? { id: "bucket-1" } : null);
      const create = vi.fn().mockResolvedValue({});
      const tx = {
        creditBucket: { findUnique },
        transaction: { create },
      } as unknown as Prisma.TransactionClient;
      const receipt = await grant({
        scope,
        tx,
        kind: "stripe_invoice",
        owner: { organizationId: "org-1" },
        invoiceId: "in_1",
        entry: "topup",
        referenceType: "STRIPE_TOPUP",
        expiresAt: null,
        get cents() {
          if (existing) throw new Error("Recomputed credits on replay");
          return 123n;
        },
        wakeTasks: true,
      });
      expect(receipt).toEqual({
        outcome: existing ? "already_granted" : "granted",
        bucketId: null,
      });
      if (existing) {
        expect(create).not.toHaveBeenCalled();
        expect(database.wake).not.toHaveBeenCalled();
      } else {
        expect(create).toHaveBeenCalledTimes(1);
        expect(database.wake).toHaveBeenCalledExactlyOnceWith({
          organizationId: "org-1",
          userId: null,
          tx,
        });
        expect(create.mock.invocationCallOrder[0]).toBeLessThan(
          database.wake.mock.invocationCallOrder[0],
        );
      }
    },
  );

  describe("a Polar grant", () => {
    const expiresAt = new Date("2026-12-28T00:00:00.000Z");
    function polarTx() {
      const create = vi.fn().mockResolvedValue({ id: "transaction-1" });
      return {
        create,
        tx: { transaction: { create } } as unknown as Prisma.TransactionClient,
      };
    }
    const polar = (polarTx: Prisma.TransactionClient) =>
      ({
        scope,
        tx: polarTx,
        kind: "polar",
        organizationId: "org-1",
        projectId: "project-1",
        cents: 7n,
        referenceId: "order-1:0",
        referenceType: "POLAR_SUBSCRIPTION_MONTH",
        note: "Growth",
        expiresAt,
      }) as const;

    it("writes its cents as the Project's bucket with no member, on the caller's transaction", async () => {
      const { create, tx: written } = polarTx();

      await expect(
        grant({ ...polar(written), wakeTasks: false }),
      ).resolves.toEqual({ outcome: "granted", bucketId: null });
      expect(create).toHaveBeenCalledExactlyOnceWith({
        data: {
          amount: 7n,
          organizationId: "org-1",
          userId: null,
          sourceCreditBucket: {
            create: {
              amount: 7n,
              expiresAt,
              organizationId: "org-1",
              projectId: "project-1",
              referenceId: "order-1:0",
              referenceNote: "Growth",
              referenceType: "POLAR_SUBSCRIPTION_MONTH",
              userId: null,
            },
          },
        },
      });
      expect(database.wake).not.toHaveBeenCalled();
    });

    it("wakes the Project's Tasks after the write when asked", async () => {
      const { create, tx: written } = polarTx();
      database.wake.mockImplementationOnce(async () => {
        expect(create).toHaveBeenCalledOnce();
      });

      await grant({ ...polar(written), wakeTasks: true });

      expect(database.wake).toHaveBeenCalledExactlyOnceWith({
        organizationId: "org-1",
        projectId: "project-1",
        tx: written,
        userId: null,
      });
    });

    it("throws the key's refusal and wakes nothing", async () => {
      const { create, tx: written } = polarTx();
      const refusal = new Error("Unique constraint failed");
      create.mockRejectedValueOnce(refusal);

      await expect(grant({ ...polar(written), wakeTasks: true })).rejects.toBe(
        refusal,
      );
      expect(database.wake).not.toHaveBeenCalled();
    });

    it("writes nothing for a scope that refuses its Network", async () => {
      const { create, tx: written } = polarTx();
      const refusal = new Error("Preprod is off");
      const refused = {
        get network(): never {
          throw refusal;
        },
      } as unknown as NetworkScope;

      await expect(
        grant({ ...polar(written), scope: refused, wakeTasks: true }),
      ).rejects.toBe(refusal);
      expect(create).not.toHaveBeenCalled();
    });
  });
});

describe("expireEnterpriseGrants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("expires the periods' buckets and the top-up's, on the caller's transaction", async () => {
    database.expireCreditBucketsNow.mockResolvedValueOnce(3);
    const now = new Date("2026-11-28T00:00:00.000Z");

    await expect(
      expireEnterpriseGrants({
        scope,
        tx,
        periodIds: ["period-1", "period-2"],
        topUpContractId: "contract-1",
        now,
      }),
    ).resolves.toBe(3);
    expect(database.expireCreditBucketsNow).toHaveBeenCalledExactlyOnceWith(
      {
        now,
        referenceIds: ["period-1", "period-2", "contract-1"],
        referenceTypes: ["ENTERPRISE_PERIOD", "ENTERPRISE_TOP_UP"],
      },
      tx,
    );
  });

  it("writes nothing for a scope that refuses its Network", async () => {
    const refusal = new Error("Preprod is off");
    const refused = {
      get network(): never {
        throw refusal;
      },
    } as unknown as NetworkScope;

    await expect(
      expireEnterpriseGrants({
        scope: refused,
        tx,
        periodIds: ["period-1"],
        topUpContractId: null,
        now: new Date(),
      }),
    ).rejects.toBe(refusal);
    expect(database.expireCreditBucketsNow).not.toHaveBeenCalled();
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
  void grant(stripe);
}
