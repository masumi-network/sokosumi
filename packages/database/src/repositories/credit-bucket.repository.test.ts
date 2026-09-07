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
