import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";

import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import { getOrganizationMemberSubscriptionReferencePrefix } from "../helpers/credit.js";
import {
  buildCreditBucketScopeWhere,
  type CreditBucketScopeContext,
} from "../helpers/credit-bucket-scope.js";
import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "./credit-bucket.repository.js";

const defaultScopeContext: CreditBucketScopeContext = {
  userId: "user-1",
  organizationId: "org-1",
  canAccessOrganizationSharedCredits: true,
  canAccessEnterprisePool: false,
};

vi.mock("../helpers/credit-bucket-scope.js", async () => {
  const actual = await vi.importActual<
    typeof import("../helpers/credit-bucket-scope.js")
  >("../helpers/credit-bucket-scope.js");

  return {
    ...actual,
    resolveCreditBucketScopeContext: vi.fn(
      async (userId: string, organizationId: string | null) => ({
        ...defaultScopeContext,
        userId,
        organizationId,
        canAccessOrganizationSharedCredits: organizationId != null,
        canAccessEnterprisePool: false,
      }),
    ),
  };
});

function extractNestedSqlValues(args: unknown[]): unknown[] {
  const sqlArg = args.find((arg) => {
    return (
      arg &&
      typeof arg === "object" &&
      "values" in arg &&
      Array.isArray((arg as { values: unknown }).values)
    );
  });

  if (!sqlArg || typeof sqlArg !== "object" || !("values" in sqlArg)) {
    return [];
  }

  const values = (sqlArg as { values: unknown[] }).values;
  if (Array.isArray(values)) {
    return values;
  }

  return [];
}

describe("creditBucketRepository.prepareConsumption (personal)", () => {
  it("consumes credits FIFO across buckets", async () => {
    const rows = [
      { id: "bucket-1", available: 60n },
      { id: "bucket-2", available: 50n },
    ];
    const tx = {
      $queryRaw: async () => rows,
    } as unknown as Prisma.TransactionClient;

    const consumptions = await creditBucketRepository.prepareConsumption(
      "user-1",
      null,
      100n,
      tx,
    );

    assert.deepEqual(consumptions, [
      { bucketId: "bucket-1", amount: 60n },
      { bucketId: "bucket-2", amount: 40n },
    ]);
  });

  it("throws when balance is insufficient", async () => {
    const rows = [{ id: "bucket-1", available: 30n }];
    const tx = {
      $queryRaw: async () => rows,
    } as unknown as Prisma.TransactionClient;

    await assert.rejects(
      () => creditBucketRepository.prepareConsumption("user-1", null, 100n, tx),
      (error: unknown) => {
        assert.ok(error instanceof InsufficientBalanceError);
        assert.match(error.message, /Insufficient balance/);
        return true;
      },
    );
  });
});

describe("creditBucketRepository.prepareConsumption (organization)", () => {
  it("consumes credits FIFO across buckets", async () => {
    const rows = [
      { id: "bucket-1", available: 60n },
      { id: "bucket-2", available: 50n },
    ];
    const tx = {
      $queryRaw: async () => rows,
      creditBucket: {
        findMany: () => {
          throw new Error("Unexpected creditBucket.findMany call");
        },
      },
      creditConsumption: {
        aggregate: () => {
          throw new Error("Unexpected creditConsumption.aggregate call");
        },
      },
    } as unknown as Prisma.TransactionClient;

    const consumptions = await creditBucketRepository.prepareConsumption(
      "user-1",
      "org-1",
      100n,
      tx,
    );

    assert.deepEqual(consumptions, [
      { bucketId: "bucket-1", amount: 60n },
      { bucketId: "bucket-2", amount: 40n },
    ]);
  });

  it("throws when balance is insufficient", async () => {
    const rows = [{ id: "bucket-1", available: 30n }];
    const tx = {
      $queryRaw: async () => rows,
      creditBucket: {
        findMany: () => {
          throw new Error("Unexpected creditBucket.findMany call");
        },
      },
      creditConsumption: {
        aggregate: () => {
          throw new Error("Unexpected creditConsumption.aggregate call");
        },
      },
    } as unknown as Prisma.TransactionClient;

    await assert.rejects(
      () =>
        creditBucketRepository.prepareConsumption("user-1", "org-1", 100n, tx),
      (error: unknown) => {
        assert.ok(error instanceof InsufficientBalanceError);
        assert.match(error.message, /Insufficient balance/);
        return true;
      },
    );
  });
});

describe("creditBucketRepository.getBalance (organization)", () => {
  it("returns organization balance via raw query", async () => {
    const tx = {
      $queryRaw: async () => [{ balance: 90n }],
      creditBucket: {
        findMany: () => {
          throw new Error("Unexpected creditBucket.findMany call");
        },
      },
      creditConsumption: {
        aggregate: () => {
          throw new Error("Unexpected creditConsumption.aggregate call");
        },
      },
    } as unknown as Prisma.TransactionClient;

    const balance = await creditBucketRepository.getBalance(
      "user-1",
      "org-1",
      tx,
    );

    assert.equal(balance, 90n);
  });

  it("scopes organization balance to shared non-subscription and member subscription buckets", async () => {
    let queryArgs: unknown[] = [];
    const tx = {
      $queryRaw: async (...rawArgs: unknown[]) => {
        queryArgs = rawArgs;
        return [{ balance: 90n }];
      },
      creditBucket: {
        findMany: () => {
          throw new Error("Unexpected creditBucket.findMany call");
        },
      },
      creditConsumption: {
        aggregate: () => {
          throw new Error("Unexpected creditConsumption.aggregate call");
        },
      },
    } as unknown as Prisma.TransactionClient;

    await creditBucketRepository.getBalance("user-1", "org-1", tx);

    const values = extractNestedSqlValues(queryArgs);
    assert.ok(values.includes("org-1"));
    assert.ok(values.includes("user-1"));
    assert.ok(
      values.includes(
        `${getOrganizationMemberSubscriptionReferencePrefix("user-1")}%`,
      ),
    );
    assert.ok(
      values.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
    const sqlText = JSON.stringify(queryArgs);
    assert.ok(sqlText.includes("activatesAt"));
  });

  it("escapes LIKE wildcards in organization member reference scope", async () => {
    let queryArgs: unknown[] = [];
    const tx = {
      $queryRaw: async (...rawArgs: unknown[]) => {
        queryArgs = rawArgs;
        return [{ balance: 90n }];
      },
      creditBucket: {
        findMany: () => {
          throw new Error("Unexpected creditBucket.findMany call");
        },
      },
      creditConsumption: {
        aggregate: () => {
          throw new Error("Unexpected creditConsumption.aggregate call");
        },
      },
    } as unknown as Prisma.TransactionClient;

    await creditBucketRepository.getBalance("user_1", "org_1", tx);

    const values = extractNestedSqlValues(queryArgs);
    assert.ok(values.includes("member:user\\_1:%"));
  });

  it("escapes LIKE wildcards in prepareConsumption for organization member scope", async () => {
    let queryArgs: unknown[] = [];
    const tx = {
      $queryRaw: async (...rawArgs: unknown[]) => {
        queryArgs = rawArgs;
        return [{ id: "bucket-1", available: 10n }];
      },
      creditBucket: {
        findMany: () => {
          throw new Error("Unexpected creditBucket.findMany call");
        },
      },
      creditConsumption: {
        aggregate: () => {
          throw new Error("Unexpected creditConsumption.aggregate call");
        },
      },
    } as unknown as Prisma.TransactionClient;

    const consumptions = await creditBucketRepository.prepareConsumption(
      "user_1",
      "org_1",
      5n,
      tx,
    );

    assert.deepEqual(consumptions, [{ bucketId: "bucket-1", amount: 5n }]);

    const values = extractNestedSqlValues(queryArgs);
    assert.ok(values.includes("member:user\\_1:%"));
  });
});

describe("creditBucketRepository.getUnexpiredBuckets (organization)", () => {
  it("uses member-scoped subscription filters and shared non-subscription filters", async () => {
    let args: Prisma.CreditBucketFindManyArgs | undefined;
    const tx = {
      creditBucket: {
        findMany: async (input: Prisma.CreditBucketFindManyArgs) => {
          args = input;
          return [];
        },
      },
      $queryRaw: () => {
        throw new Error("Unexpected $queryRaw call");
      },
      creditConsumption: {
        aggregate: () => {
          throw new Error("Unexpected creditConsumption.aggregate call");
        },
      },
    } as unknown as Prisma.TransactionClient;

    await creditBucketRepository.getUnexpiredBuckets("user-1", "org-1", tx);

    assert.ok(args);
    assert.deepEqual(args.orderBy, [
      { expiresAt: { sort: "asc", nulls: "last" } },
      { amount: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ]);
    assert.ok(args.where);
    const andClause = args.where.AND;
    assert.ok(Array.isArray(andClause));
    const scopeWhere = andClause[0] as {
      organizationId?: string;
      OR?: Array<Record<string, unknown>>;
    };
    assert.equal(scopeWhere.organizationId, "org-1");
    assert.deepEqual(
      scopeWhere.OR,
      buildCreditBucketScopeWhere({
        userId: "user-1",
        organizationId: "org-1",
        canAccessOrganizationSharedCredits: true,
        canAccessEnterprisePool: false,
      }).OR,
    );
    const activationWhere = andClause[1] as { OR?: unknown[] };
    assert.ok(Array.isArray(activationWhere.OR));
  });

  it("uses escaped prefix for startsWith when userId contains LIKE wildcards", async () => {
    let args: Prisma.CreditBucketFindManyArgs | undefined;
    const tx = {
      creditBucket: {
        findMany: async (input: Prisma.CreditBucketFindManyArgs) => {
          args = input;
          return [];
        },
      },
      $queryRaw: () => {
        throw new Error("Unexpected $queryRaw call");
      },
      creditConsumption: {
        aggregate: () => {
          throw new Error("Unexpected creditConsumption.aggregate call");
        },
      },
    } as unknown as Prisma.TransactionClient;

    await creditBucketRepository.getUnexpiredBuckets("user_1", "org-1", tx);

    assert.ok(args);
    assert.ok(args.where);
    const andClauseWildcard = args.where.AND;
    assert.ok(Array.isArray(andClauseWildcard));
    const scopeWhere = andClauseWildcard[0] as {
      OR?: Array<Record<string, unknown>>;
    };
    const subscriptionBranch = (
      scopeWhere.OR as Array<Record<string, unknown>>
    ).find(
      (o) =>
        o.referenceType ===
        CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
    );
    assert.ok(subscriptionBranch);
    assert.equal(
      (subscriptionBranch.referenceId as { startsWith: string }).startsWith,
      "member:user\\_1:",
    );
  });
});

describe("creditBucketRepository.sumOrganizationOwnedCreditBalances", () => {
  it("returns remaining cents from the raw query", async () => {
    const tx = {
      $queryRaw: async () => [{ totalCents: 200n, remainingCents: 90n }],
    } as unknown as Prisma.TransactionClient;

    const balances =
      await creditBucketRepository.sumOrganizationOwnedCreditBalances(
        "org-1",
        tx,
      );

    assert.deepEqual(balances, { totalCents: 200n, remainingCents: 90n });
  });

  it("scopes to org-owned non-enterprise buckets without an actor userId", async () => {
    let queryArgs: unknown[] = [];
    const tx = {
      $queryRaw: async (...rawArgs: unknown[]) => {
        queryArgs = rawArgs;
        return [{ totalCents: 0n, remainingCents: 0n }];
      },
    } as unknown as Prisma.TransactionClient;

    await creditBucketRepository.sumOrganizationOwnedCreditBalances(
      "org-1",
      tx,
    );

    const sqlText = JSON.stringify(queryArgs);
    assert.ok(sqlText.includes("org-1"));
    assert.ok(sqlText.includes(CreditBucketReferenceType.ENTERPRISE_PERIOD));
    assert.ok(sqlText.includes(CreditBucketReferenceType.ENTERPRISE_TOP_UP));
    assert.ok(sqlText.includes("userId"));
    assert.ok(!sqlText.includes("user-1"));
    assert.ok(!sqlText.includes("user_owner"));
  });
});

describe("creditBucketRepository.listAvailableBucketsWithBalances", () => {
  it("returns FIFO-ordered rows with total and remaining cents", async () => {
    const expiresSoon = new Date("2026-06-01T00:00:00.000Z");
    const expiresLater = new Date("2026-12-01T00:00:00.000Z");
    const tx = {
      $queryRaw: async () => [
        {
          totalCents: 100n,
          remainingCents: 40n,
          expiresAt: expiresSoon,
        },
        {
          totalCents: 200n,
          remainingCents: 200n,
          expiresAt: expiresLater,
        },
      ],
    } as unknown as Prisma.TransactionClient;

    const rows = await creditBucketRepository.listAvailableBucketsWithBalances(
      "user-1",
      null,
      tx,
    );

    assert.deepEqual(rows, [
      {
        totalCents: 100n,
        remainingCents: 40n,
        expiresAt: expiresSoon,
      },
      {
        totalCents: 200n,
        remainingCents: 200n,
        expiresAt: expiresLater,
      },
    ]);
  });

  it("scopes organization listing to member subscription pattern", async () => {
    let queryArgs: unknown[] = [];
    const tx = {
      $queryRaw: async (...rawArgs: unknown[]) => {
        queryArgs = rawArgs;
        return [];
      },
    } as unknown as Prisma.TransactionClient;

    await creditBucketRepository.listAvailableBucketsWithBalances(
      "user-1",
      "org-1",
      tx,
    );

    const values = extractNestedSqlValues(queryArgs);
    assert.ok(values.includes("org-1"));
    assert.ok(values.includes("user-1"));
    assert.ok(
      values.includes(
        `${getOrganizationMemberSubscriptionReferencePrefix("user-1")}%`,
      ),
    );
    assert.ok(
      values.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
  });
});

describe("creditBucketRepository.prepareConsumption (organization scope SQL)", () => {
  it("filters organization subscription consumption to member-prefixed references", async () => {
    let queryArgs: unknown[] = [];
    const tx = {
      $queryRaw: async (...rawArgs: unknown[]) => {
        queryArgs = rawArgs;
        return [{ id: "bucket-1", available: 10n }];
      },
    } as unknown as Prisma.TransactionClient;

    await creditBucketRepository.prepareConsumption("user-1", "org-1", 5n, tx);

    const values = extractNestedSqlValues(queryArgs);
    assert.ok(values.includes("org-1"));
    assert.ok(values.includes("user-1"));
    assert.ok(
      values.includes(
        `${getOrganizationMemberSubscriptionReferencePrefix("user-1")}%`,
      ),
    );
    assert.ok(
      values.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
  });
});
