import type { Prisma } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";

import {
  forfeitCusoProjectCredits,
  forfeitCusoProjectCreditsIfLeavingCmo,
} from "./cuso-project-credits";

const BOT_ID = "01960001-0001-7001-8001-00000000000a";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";

function forfeitTx(cuso: { projectId: string | null } | null, rows: unknown[]) {
  const findFirst = vi.fn().mockResolvedValue(cuso);
  const queries: unknown[][] = [];
  const created: unknown[] = [];
  const tx = {
    sokoBot: { findFirst },
    $queryRaw: async (...rawArgs: unknown[]) => {
      queries.push(rawArgs);
      return rows;
    },
    transaction: {
      create: async (args: unknown) => {
        created.push(args);
        return {};
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, findFirst, queries, created };
}

describe("forfeitCusoProjectCredits", () => {
  it("asks for this bot as a live Cuso", async () => {
    const { tx, findFirst } = forfeitTx(null, []);

    await forfeitCusoProjectCredits(BOT_ID, tx);

    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: BOT_ID,
        versionId: { in: [...CMO_SOKO_BOT_VERSION_IDS] },
        userId: null,
        projectId: { not: null },
        deletedAt: null,
        archivedAt: null,
      },
      select: { projectId: true },
    });
  });

  it("writes nothing off when the bot is not a live Cuso", async () => {
    const { tx, queries, created } = forfeitTx(null, [
      { id: "bucket-1", organizationId: "org-1", userId: null, remaining: 7n },
    ]);

    await forfeitCusoProjectCredits(BOT_ID, tx);

    expect(queries).toEqual([]);
    expect(created).toEqual([]);
  });

  it("spends each of the Project's buckets for exactly its remaining amount", async () => {
    const { tx, queries, created } = forfeitTx({ projectId: PROJECT_ID }, [
      { id: "bucket-1", organizationId: "org-1", userId: null, remaining: 7n },
      { id: "bucket-2", organizationId: "org-1", userId: null, remaining: 3n },
    ]);

    await forfeitCusoProjectCredits(BOT_ID, tx);

    const [strings, ...values] = queries[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const text = strings.join("?").replace(/\s+/g, " ");
    // Only this Project's buckets: the pool (projectId null) and other
    // Projects never match the equality.
    expect(text).toMatch(/WHERE cb\."projectId" = \?::uuid/);
    expect(text).not.toContain('"projectId" IS NULL');
    expect(values.slice(0, 1)).toEqual([PROJECT_ID]);
    expect(created).toEqual([
      {
        data: {
          amount: -7n,
          organizationId: "org-1",
          userId: null,
          creditConsumptions: { create: { amount: 7n, bucketId: "bucket-1" } },
        },
      },
      {
        data: {
          amount: -3n,
          organizationId: "org-1",
          userId: null,
          creditConsumptions: { create: { amount: 3n, bucketId: "bucket-2" } },
        },
      },
    ]);
  });

  it("writes nothing when the Project has no credits left", async () => {
    const { tx, created } = forfeitTx({ projectId: PROJECT_ID }, []);

    await forfeitCusoProjectCredits(BOT_ID, tx);

    expect(created).toEqual([]);
  });
});

describe("forfeitCusoProjectCreditsIfLeavingCmo", () => {
  it("keeps the Project credits on a move between CMO versions", async () => {
    const { tx, findFirst } = forfeitTx({ projectId: PROJECT_ID }, []);

    await forfeitCusoProjectCreditsIfLeavingCmo(
      BOT_ID,
      CMO_SOKO_BOT_VERSION_IDS.at(-1) as string,
      tx,
    );

    expect(findFirst).not.toHaveBeenCalled();
  });

  it("forfeits them on a move off CMO", async () => {
    const { tx, created } = forfeitTx({ projectId: PROJECT_ID }, [
      { id: "bucket-1", organizationId: "org-1", userId: null, remaining: 7n },
    ]);

    await forfeitCusoProjectCreditsIfLeavingCmo(BOT_ID, "v16", tx);

    expect(created).toHaveLength(1);
  });
});
