import assert from "node:assert/strict";
import { FREE_SUBSCRIPTION_MONTHLY_CREDITS } from "@sokosumi/utils";
import { describe, it, vi } from "vitest";
import { type Prisma as PrismaType } from "../generated/prisma/client.js";

import {
  buildLocalFreeOrganizationSubscriptionReferenceId,
  buildLocalFreeUserSubscriptionReferenceId,
  type EnsureLocalFreeOrganizationSubscriptionPeriodParams,
  type EnsureLocalFreeUserSubscriptionPeriodParams,
  ensureLocalFreeSubscriptionPeriod,
  type GrantLocalFreePeriodCredits,
  grantLocalFreePeriodCredits,
} from "./subscription.js";

/**
 * The grant port as Core's credits module fills it (`grant`): the period's
 * writer, on the same transaction.
 */
function writing(
  tx: PrismaType.TransactionClient,
): GrantLocalFreePeriodCredits {
  return async (credits) => ({
    outcome: (await grantLocalFreePeriodCredits(credits, tx)).created
      ? "granted"
      : "already_granted",
  });
}

interface LocalFreePeriodGrantMatrixCase {
  expectedGrantCount: number;
  expectedGrantUserIds: Array<string | null>;
  expectedReferenceIds: string[];
  name: string;
  /** Without the grant port: each test passes the writer on its client. */
  params:
    | Omit<EnsureLocalFreeUserSubscriptionPeriodParams, "grantCredits">
    | Omit<EnsureLocalFreeOrganizationSubscriptionPeriodParams, "grantCredits">;
}

function createLocalFreePeriodClient() {
  const findSubscriptionMock = vi.fn().mockResolvedValue(null);
  const createSubscriptionMock = vi.fn().mockResolvedValue({
    id: "subscription-local-free",
  });
  const queryRawMock = vi.fn().mockResolvedValue([]);
  const executeRawMock = vi.fn().mockResolvedValue(1);

  return {
    createSubscriptionMock,
    executeRawMock,
    findSubscriptionMock,
    queryRawMock,
    tx: {
      $queryRaw: queryRawMock,
      $executeRaw: executeRawMock,
      subscription: {
        create: createSubscriptionMock,
        findFirst: findSubscriptionMock,
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
    name: "org local free — one org-owned 250 bucket for the pool",
    params: {
      billingAnchorDate: PERIOD_START,
      organizationId: "org-1",
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      purchasedSeats: 2,
      referenceId: "org-1",
    },
    expectedGrantCount: 1,
    expectedGrantUserIds: [null],
    expectedReferenceIds: [
      buildLocalFreeOrganizationSubscriptionReferenceId("org-1", PERIOD_END),
    ],
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
        const { executeRawMock, tx } = createLocalFreePeriodClient();

        const result = await ensureLocalFreeSubscriptionPeriod(
          { ...params, grantCredits: writing(tx) },
          tx,
        );

        assert.equal(result.grantsCreated, expectedGrantCount);
        // Each grant writes one Transaction INSERT and one credit_bucket INSERT.
        assert.equal(executeRawMock.mock.calls.length, expectedGrantCount * 2);

        const bucketCalls = executeRawMock.mock.calls.filter(
          (_call, index) => index % 2 === 1,
        );
        const grantUserIds = bucketCalls.map((call) => call[13]);
        assert.deepEqual(grantUserIds, expectedGrantUserIds);

        const grantReferenceIds = bucketCalls.map((call) => call[8]);
        assert.deepEqual(grantReferenceIds, expectedReferenceIds);

        for (const call of bucketCalls) {
          const grantAmount = call[5] as bigint;
          assert.equal(
            grantAmount,
            BigInt(FREE_SUBSCRIPTION_MONTHLY_CREDITS * 10_000_000_000),
          );
        }
      });
    },
  );
});
