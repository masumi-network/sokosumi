import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";

import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "./credit-bucket.repository.js";

vi.mock("../helpers/credit-bucket-scope.js", async () => {
  const actual = await vi.importActual<
    typeof import("../helpers/credit-bucket-scope.js")
  >("../helpers/credit-bucket-scope.js");

  return {
    ...actual,
    resolveCreditBucketScopeContext: vi.fn(
      async (userId: string, organizationId: string | null) => {
        if (organizationId == null) {
          return {
            workspace: "personal" as const,
            userId,
          };
        }

        return {
          workspace: "organization" as const,
          userId,
          organizationId,
          poolAccess: "shared" as const,
        };
      },
    ),
  };
});

function extractNestedSql(args: unknown[]): {
  values: unknown[];
  text: string;
} {
  const sqlArg = args.find((arg) => {
    return (
      arg &&
      typeof arg === "object" &&
      "values" in arg &&
      Array.isArray((arg as { values: unknown }).values)
    );
  });

  if (!sqlArg || typeof sqlArg !== "object") {
    return { values: [], text: "" };
  }

  const values =
    "values" in sqlArg && Array.isArray(sqlArg.values) ? sqlArg.values : [];
  const text =
    "strings" in sqlArg && Array.isArray(sqlArg.strings)
      ? sqlArg.strings.join("")
      : "";

  return { values, text };
}

function extractNestedSqlValues(args: unknown[]): unknown[] {
  return extractNestedSql(args).values;
}

function hasMemberPrefixValue(values: unknown[]): boolean {
  return values.some(
    (value) => typeof value === "string" && value.includes("member:"),
  );
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

  it("scopes organization balance to shared org-owned buckets without leftover member: matching", async () => {
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

    const { values, text } = extractNestedSql(queryArgs);
    assert.ok(values.includes("org-1"));
    assert.ok(!values.includes("user-1"));
    assert.equal(hasMemberPrefixValue(values), false);
    assert.ok(
      values.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
    const sqlText = JSON.stringify(queryArgs);
    assert.ok(sqlText.includes("activatesAt"));
    assert.ok(text.includes('cb."userId" IS NULL'));
    assert.ok(!sqlText.includes("member:user-1:%"));
  });

  it("does not bind leftover member: LIKE patterns for organization balance", async () => {
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
    assert.ok(!values.includes("member:user\\_1:%"));
    assert.equal(hasMemberPrefixValue(values), false);
    assert.ok(!values.includes("user_1"));
  });

  it("does not bind leftover member: LIKE patterns in prepareConsumption", async () => {
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
    assert.ok(!values.includes("member:user\\_1:%"));
    assert.equal(hasMemberPrefixValue(values), false);
    assert.ok(!values.includes("user_1"));
  });
});

describe("creditBucketRepository.getUnexpiredBuckets (organization)", () => {
  it("uses shared org-owned filters without leftover member: startsWith", async () => {
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
    const branches = scopeWhere.OR ?? [];
    assert.equal(
      branches.some((branch) => {
        const referenceId = branch.referenceId;
        return (
          typeof referenceId === "object" &&
          referenceId !== null &&
          "startsWith" in referenceId &&
          String((referenceId as { startsWith: string }).startsWith).startsWith(
            "member:",
          )
        );
      }),
      false,
    );
    assert.ok(
      branches.some(
        (branch) =>
          branch.referenceType ===
            CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD &&
          branch.userId === null,
      ),
    );
    const activationWhere = andClause[1] as { OR?: unknown[] };
    assert.ok(Array.isArray(activationWhere.OR));
  });

  it("does not use leftover member: startsWith when userId contains LIKE wildcards", async () => {
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
    const leftoverBranch = (scopeWhere.OR ?? []).find((branch) => {
      const referenceId = branch.referenceId;
      return (
        typeof referenceId === "object" &&
        referenceId !== null &&
        "startsWith" in referenceId
      );
    });
    assert.equal(leftoverBranch, undefined);
    const subscriptionBranch = (scopeWhere.OR ?? []).find(
      (branch) =>
        branch.referenceType ===
        CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
    );
    assert.ok(subscriptionBranch);
    assert.equal(subscriptionBranch.userId, null);
    assert.equal(subscriptionBranch.referenceId, undefined);
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

  it("scopes organization listing without leftover member: matching", async () => {
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
    assert.ok(!values.includes("user-1"));
    assert.equal(hasMemberPrefixValue(values), false);
    assert.ok(
      values.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
  });
});

describe("creditBucketRepository.prepareConsumption (organization scope SQL)", () => {
  it("filters organization consumption without leftover member: matching", async () => {
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
    assert.ok(!values.includes("user-1"));
    assert.equal(hasMemberPrefixValue(values), false);
    assert.ok(
      values.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
  });
});
