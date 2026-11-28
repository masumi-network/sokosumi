import type { Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import type { MainnetScope } from "@/lib/db/network-scope";

import { writeOff } from "./write-off";

const scope = { network: "mainnet" } as MainnetScope;

function writeOffTx(
  left: {
    id: string;
    remaining: bigint;
    organizationId?: string | null;
    userId?: string | null;
  }[],
) {
  const queryRaw = vi.fn().mockResolvedValue(
    left.map((bucket) => ({
      organizationId: "org-1",
      userId: null,
      ...bucket,
    })),
  );
  const executeRaw = vi.fn().mockResolvedValue(1);
  const tx = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
  } as unknown as Prisma.TransactionClient;
  return { tx, queryRaw, executeRaw };
}

describe("writeOff", () => {
  it("spends what is left of each bucket it finds, on the caller's transaction", async () => {
    const { tx, queryRaw, executeRaw } = writeOffTx([
      { id: "bucket-1", remaining: 18n },
      { id: "bucket-2", remaining: 5n },
    ]);

    await writeOff({ scope, tx, of: { bucketIds: ["bucket-1", "bucket-2"] } });

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(queryRaw.mock.calls[0]?.[0]?.values).toEqual(
      expect.arrayContaining(["bucket-1", "bucket-2"]),
    );
    expect(executeRaw).toHaveBeenCalledTimes(4);
    const writes = [0, 2].map((i) => {
      const [, ...txVals] = executeRaw.mock.calls[i] ?? [];
      const [, ...ccVals] = executeRaw.mock.calls[i + 1] ?? [];
      return {
        txAmount: txVals[4],
        txUserId: txVals[5],
        txOrgId: txVals[6],
        ccAmount: ccVals[3],
        ccBucketId: ccVals[4],
        linkedTxId: ccVals[5] === txVals[1],
        sameTimestamp: txVals[2] === ccVals[2],
      };
    });
    expect(writes).toEqual([
      {
        txAmount: -18n,
        txUserId: null,
        txOrgId: "org-1",
        ccAmount: 18n,
        ccBucketId: "bucket-1",
        linkedTxId: true,
        sameTimestamp: true,
      },
      {
        txAmount: -5n,
        txUserId: null,
        txOrgId: "org-1",
        ccAmount: 5n,
        ccBucketId: "bucket-2",
        linkedTxId: true,
        sameTimestamp: true,
      },
    ]);
  });

  it("writes each spend to its bucket's owner as stored, an empty id included", async () => {
    const { tx, executeRaw } = writeOffTx([
      {
        id: "bucket-person",
        remaining: 3n,
        organizationId: null,
        userId: "user-1",
      },
      {
        id: "bucket-empty-person",
        remaining: 2n,
        organizationId: null,
        userId: "",
      },
      {
        id: "bucket-empty-org",
        remaining: 1n,
        organizationId: "",
        userId: null,
      },
    ]);

    await writeOff({
      scope,
      tx,
      of: {
        bucketIds: ["bucket-person", "bucket-empty-person", "bucket-empty-org"],
      },
    });

    const txRows = [0, 2, 4].map((i) => {
      const [, ...txVals] = executeRaw.mock.calls[i] ?? [];
      return [txVals[6], txVals[5], txVals[4]];
    });
    expect(txRows).toEqual([
      [null, "user-1", -3n],
      [null, "", -2n],
      ["", null, -1n],
    ]);
  });

  it("reads a Project's buckets by its id", async () => {
    const { tx, queryRaw, executeRaw } = writeOffTx([]);

    await writeOff({ scope, tx, of: { projectId: "project-1" } });

    expect(queryRaw.mock.calls[0]?.[0]?.values).toContain("project-1");
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("sends nothing for no buckets", async () => {
    const { tx, queryRaw } = writeOffTx([]);

    await writeOff({ scope, tx, of: { bucketIds: [] } });

    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("writes nothing for a scope that refuses its Network", async () => {
    const { tx, queryRaw } = writeOffTx([{ id: "bucket-1", remaining: 1n }]);
    const refusal = new Error("Preprod is off");
    const refused = {
      get network(): never {
        throw refusal;
      },
    } as unknown as MainnetScope;

    await expect(
      writeOff({ scope: refused, tx, of: { projectId: "project-1" } }),
    ).rejects.toBe(refusal);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
