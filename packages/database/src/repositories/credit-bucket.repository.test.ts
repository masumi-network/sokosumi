import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";

import {
  CreditBucketReferenceType,
  Prisma,
} from "../generated/prisma/client.js";
import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "./credit-bucket.repository.js";

vi.mock("../helpers/organization-billing-plan.js", () => ({
  resolveOrganizationBillingPlan: vi.fn(),
}));

import { resolveOrganizationBillingPlan } from "../helpers/organization-billing-plan.js";

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

describe("creditBucketRepository.listProjectBucketsWithBalances", () => {
  it("lists the organization's Project credits, named by Project", async () => {
    let queryArgs: unknown[] = [];
    const row = {
      totalCents: 1_000_000n,
      remainingCents: 900_000n,
      expiresAt: null,
      projectId: "project-1",
      projectName: "Acme launch",
    };
    const tx = {
      $queryRaw: async (...rawArgs: unknown[]) => {
        queryArgs = rawArgs;
        return [row];
      },
    } as unknown as Prisma.TransactionClient;

    const rows = await creditBucketRepository.listProjectBucketsWithBalances(
      "user-1",
      "org-1",
      tx,
    );

    assert.deepEqual(rows, [row]);
    const { text, values } = extractNestedSql(queryArgs);
    assert.ok(values.includes("org-1"));
    assert.ok(text.includes('cb."projectId" IS NOT NULL'));
    const query = (queryArgs[0] as string[]).join("");
    assert.ok(query.includes('p.name AS "projectName"'));
    assert.ok(query.includes('LEFT JOIN project p ON p.id = cb."projectId"'));
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

describe("creditBucketRepository with Project credits", () => {
  function capturingTx(rows: unknown[]) {
    const calls: unknown[][] = [];
    const tx = {
      $queryRaw: async (...rawArgs: unknown[]) => {
        calls.push(rawArgs);
        return rows;
      },
    } as unknown as Prisma.TransactionClient;
    return { tx, calls };
  }

  function queryText(args: unknown[]): string {
    const [strings, ...values] = args as [TemplateStringsArray, ...unknown[]];
    return Prisma.sql(strings, ...values).sql.replace(/\s+/g, " ");
  }

  it("draws a Project's buckets first, then the pool in today's order", async () => {
    const { tx, calls } = capturingTx([{ id: "bucket-1", available: 10n }]);

    await creditBucketRepository.prepareConsumption("user-1", "org-1", 5n, tx, {
      projectId: "project-1",
    });

    const { values, text } = extractNestedSql(calls[0]);
    assert.ok(values.includes("project-1"));
    assert.ok(text.includes('cb."projectId" IS NULL OR cb."projectId" = '));
    assert.match(
      queryText(calls[0]),
      /ORDER BY \("projectId" IS NULL\) ASC, "expiresAt" ASC NULLS LAST, amount ASC, "createdAt" ASC, id ASC/,
    );
  });

  it("without a Project consumes only the pool, in today's order", async () => {
    const { tx, calls } = capturingTx([{ id: "bucket-1", available: 10n }]);

    await creditBucketRepository.prepareConsumption("user-1", "org-1", 5n, tx);

    const { values, text } = extractNestedSql(calls[0]);
    assert.ok(text.includes('cb."projectId" IS NULL'));
    assert.ok(!text.includes('cb."projectId" ='));
    assert.ok(!values.includes("project-1"));
    assert.match(
      queryText(calls[0]),
      /ORDER BY "expiresAt" ASC NULLS LAST, amount ASC, "createdAt" ASC, id ASC/,
    );
  });

  it("reads the same scope for the balance as for consumption", async () => {
    const { tx, calls } = capturingTx([{ balance: 90n }]);

    const balance = await creditBucketRepository.getBalance(
      "user-1",
      "org-1",
      tx,
      { projectId: "project-1" },
    );

    assert.equal(balance, 90n);
    const { values, text } = extractNestedSql(calls[0]);
    assert.ok(values.includes("project-1"));
    assert.ok(text.includes('cb."projectId" IS NULL OR cb."projectId" = '));
  });

  it("lists a Project's buckets first when given that Project", async () => {
    const { tx, calls } = capturingTx([]);

    await creditBucketRepository.listAvailableBucketsWithBalances(
      "user-1",
      "org-1",
      tx,
      { projectId: "project-1" },
    );

    assert.ok(extractNestedSql(calls[0]).values.includes("project-1"));
    assert.match(queryText(calls[0]), /ORDER BY \("projectId" IS NULL\) ASC/);
  });

  it("reads the Organization pool with a Project's credits when given one", async () => {
    vi.mocked(resolveOrganizationBillingPlan).mockResolvedValue({
      mode: "self_serve",
      plan: "free",
    } as never);
    const { tx, calls } = capturingTx([{ balance: 7n }]);

    const withProject = await creditBucketRepository.getOrganizationPoolBalance(
      "org-1",
      tx,
      {
        projectId: "project-1",
      },
    );
    await creditBucketRepository.getOrganizationPoolBalance("org-1", tx);

    assert.equal(withProject, 7n);
    assert.ok(extractNestedSql(calls[0]).values.includes("project-1"));
    assert.ok(!JSON.stringify(calls[1]).includes("project-1"));
    assert.ok(
      extractNestedSql(calls[1]).text.includes('cb."projectId" IS NULL'),
    );
  });

  it("counts every owned bucket in the admin total, Project credits included", async () => {
    const { tx, calls } = capturingTx([{ totalCents: 0n, remainingCents: 0n }]);

    await creditBucketRepository.sumOrganizationOwnedCreditBalances(
      "org-1",
      tx,
    );

    assert.ok(!JSON.stringify(calls[0]).includes("projectId"));
  });
});
