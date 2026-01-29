import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Prisma } from "../../generated/prisma/client.js";
import { creditBucketRepository } from "../credit-bucket.repository.js";

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
      /Insufficient balance/,
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
      /Insufficient balance/,
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
});
