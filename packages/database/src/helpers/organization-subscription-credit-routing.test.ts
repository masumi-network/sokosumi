import assert from "node:assert/strict";
import { FREE_SUBSCRIPTION_MONTHLY_CREDITS } from "@sokosumi/utils";
import { describe, it, vi } from "vitest";
import { type Prisma as PrismaType } from "../generated/prisma/client.js";

import {
  buildLocalFreeOrganizationMemberSubscriptionReferenceId,
  buildLocalFreeUserSubscriptionReferenceId,
  type EnsureLocalFreeSubscriptionPeriodParams,
  ensureLocalFreeSubscriptionPeriod,
  grantFreeOrganizationMemberSubscriptionCredits,
} from "./subscription.js";

interface LocalFreePeriodGrantMatrixCase {
  expectedGrantCount: number;
  expectedGrantUserIds: string[];
  expectedReferenceIds: string[];
  name: string;
  params: EnsureLocalFreeSubscriptionPeriodParams;
}

interface PaidOrgFreeTierGrantMatrixCase {
  expectedGrantCount: number;
  expectedGrantUserIds: string[];
  memberUserIds: string[];
  name: string;
}

function createLocalFreePeriodClient() {
  const findSubscriptionMock = vi.fn().mockResolvedValue(null);
  const createSubscriptionMock = vi.fn().mockResolvedValue({
    id: "subscription-local-free",
  });
  const findUniqueBucketMock = vi.fn().mockResolvedValue(null);
  const createTransactionMock = vi.fn().mockResolvedValue({
    id: "tx_local_free",
  });

  return {
    createSubscriptionMock,
    createTransactionMock,
    findSubscriptionMock,
    findUniqueBucketMock,
    tx: {
      creditBucket: {
        findUnique: findUniqueBucketMock,
      },
      subscription: {
        create: createSubscriptionMock,
        findFirst: findSubscriptionMock,
      },
      transaction: {
        create: createTransactionMock,
      },
    } as unknown as PrismaType.TransactionClient,
  };
}

function createPaidOrgFreeGrantClient(params?: {
  existingFreeBucketReferenceIds?: string[];
}) {
  const findUniqueBucketMock = vi.fn().mockImplementation(
    ({
      where,
    }: {
      where: {
        referenceId_referenceType: {
          referenceId: string;
        };
      };
    }) => {
      const referenceId = where.referenceId_referenceType.referenceId;
      return Promise.resolve(
        params?.existingFreeBucketReferenceIds?.includes(referenceId)
          ? { id: "existing-free-bucket" }
          : null,
      );
    },
  );
  const createTransactionMock = vi.fn().mockResolvedValue({
    id: "tx_free",
  });

  return {
    createTransactionMock,
    findUniqueBucketMock,
    tx: {
      creditBucket: {
        findUnique: findUniqueBucketMock,
      },
      transaction: {
        create: createTransactionMock,
      },
    } as unknown as PrismaType.TransactionClient,
  };
}

const PERIOD_END = new Date("2026-05-01T00:00:00.000Z");
const PERIOD_START = new Date("2026-04-01T00:00:00.000Z");

const LOCAL_FREE_PERIOD_GRANT_MATRIX: LocalFreePeriodGrantMatrixCase[] = [
  {
    name: "personal local free — single user grant",
    params: {
      billingAnchorDate: PERIOD_START,
      organizationId: null,
      userId: "user-1",
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      referenceId: "user-1",
    },
    expectedGrantCount: 1,
    expectedGrantUserIds: ["user-1"],
    expectedReferenceIds: [
      buildLocalFreeUserSubscriptionReferenceId("user-1", PERIOD_END),
    ],
  },
  {
    name: "org local free — assigned and unassigned members both receive grants",
    params: {
      billingAnchorDate: PERIOD_START,
      memberUserIds: ["assigned-1", "unassigned-1"],
      organizationId: "org-1",
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      purchasedSeats: 2,
      referenceId: "org-1",
    },
    expectedGrantCount: 2,
    expectedGrantUserIds: ["assigned-1", "unassigned-1"],
    expectedReferenceIds: [
      buildLocalFreeOrganizationMemberSubscriptionReferenceId(
        "assigned-1",
        "org-1",
        PERIOD_END,
      ),
      buildLocalFreeOrganizationMemberSubscriptionReferenceId(
        "unassigned-1",
        "org-1",
        PERIOD_END,
      ),
    ],
  },
];

const PAID_ORG_FREE_TIER_GRANT_MATRIX: PaidOrgFreeTierGrantMatrixCase[] = [
  {
    name: "org paid — free tier grants only the supplied unassigned member ids",
    memberUserIds: ["unassigned-1"],
    expectedGrantCount: 1,
    expectedGrantUserIds: ["unassigned-1"],
  },
  {
    name: "org paid — assigned member ids are not included in free-tier grant batch",
    memberUserIds: [],
    expectedGrantCount: 0,
    expectedGrantUserIds: [],
  },
];

describe("organization subscription credit routing matrix", () => {
  describe.each(LOCAL_FREE_PERIOD_GRANT_MATRIX)(
    "local free period grants — $name",
    (testCase: LocalFreePeriodGrantMatrixCase) => {
      const {
        expectedGrantCount,
        expectedGrantUserIds,
        expectedReferenceIds,
        params,
      } = testCase;
      it("creates the expected number of 250-credit buckets", async () => {
        const { createTransactionMock, tx } = createLocalFreePeriodClient();

        const result = await ensureLocalFreeSubscriptionPeriod(params, tx);

        assert.equal(result.grantsCreated, expectedGrantCount);
        assert.equal(
          createTransactionMock.mock.calls.length,
          expectedGrantCount,
        );

        const grantUserIds = createTransactionMock.mock.calls.map(
          (
            call: [
              {
                data: {
                  sourceCreditBucket: {
                    create: { userId: string; referenceId: string };
                  };
                };
              },
            ],
          ) => call[0].data.sourceCreditBucket.create.userId,
        );
        assert.deepEqual(grantUserIds, expectedGrantUserIds);

        const grantReferenceIds = createTransactionMock.mock.calls.map(
          (
            call: [
              {
                data: {
                  sourceCreditBucket: {
                    create: { referenceId: string };
                  };
                };
              },
            ],
          ) => call[0].data.sourceCreditBucket.create.referenceId,
        );
        assert.deepEqual(grantReferenceIds, expectedReferenceIds);

        for (const call of createTransactionMock.mock.calls) {
          const grantAmount = call[0].data.sourceCreditBucket.create
            .amount as bigint;
          assert.equal(
            grantAmount,
            BigInt(FREE_SUBSCRIPTION_MONTHLY_CREDITS * 10_000_000_000),
          );
        }
      });
    },
  );

  describe.each(PAID_ORG_FREE_TIER_GRANT_MATRIX)(
    "paid org free-tier helper — $name",
    (testCase: PaidOrgFreeTierGrantMatrixCase) => {
      const { expectedGrantCount, expectedGrantUserIds, memberUserIds } =
        testCase;
      it("grants only to the supplied member user ids", async () => {
        const { createTransactionMock, tx } = createPaidOrgFreeGrantClient();

        const grantsCreated =
          await grantFreeOrganizationMemberSubscriptionCredits(
            {
              memberUserIds,
              now: PERIOD_START,
              organizationId: "org-1",
              periodEnd: PERIOD_END,
            },
            tx,
          );

        assert.equal(grantsCreated, expectedGrantCount);
        assert.equal(
          createTransactionMock.mock.calls.length,
          expectedGrantCount,
        );

        const grantUserIds = createTransactionMock.mock.calls.map(
          (
            call: [
              {
                data: {
                  sourceCreditBucket: {
                    create: { userId: string };
                  };
                };
              },
            ],
          ) => call[0].data.sourceCreditBucket.create.userId,
        );
        assert.deepEqual(grantUserIds, expectedGrantUserIds);
      });
    },
  );
});
