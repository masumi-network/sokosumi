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
  const create = vi.fn().mockResolvedValue({});
  const tx = {
    $queryRaw: queryRaw,
    transaction: { create },
  } as unknown as Prisma.TransactionClient;
  return { tx, queryRaw, create };
}

describe("writeOff", () => {
  it("spends what is left of each bucket it finds, on the caller's transaction", async () => {
    const { tx, queryRaw, create } = writeOffTx([
      { id: "bucket-1", remaining: 18n },
      { id: "bucket-2", remaining: 5n },
    ]);

    await writeOff({ scope, tx, of: { bucketIds: ["bucket-1", "bucket-2"] } });

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(queryRaw.mock.calls[0]?.[0]?.values).toEqual(
      expect.arrayContaining(["bucket-1", "bucket-2"]),
    );
    expect(create.mock.calls).toEqual(
      [
        ["bucket-1", 18n],
        ["bucket-2", 5n],
      ].map(([bucketId, amount]) => [
        {
          data: {
            amount: -(amount as bigint),
            organizationId: "org-1",
            userId: null,
            creditConsumptions: { create: { amount, bucketId } },
          },
        },
      ]),
    );
  });

  it("writes each spend to its bucket's owner as stored, an empty id included", async () => {
    const { tx, create } = writeOffTx([
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

    expect(
      create.mock.calls.map(([args]) => {
        const { data } = args as {
          data: { organizationId: unknown; userId: unknown; amount: bigint };
        };
        return [data.organizationId, data.userId, data.amount];
      }),
    ).toEqual([
      [null, "user-1", -3n],
      [null, "", -2n],
      ["", null, -1n],
    ]);
  });

  it("reads a Project's buckets by its id", async () => {
    const { tx, queryRaw, create } = writeOffTx([]);

    await writeOff({ scope, tx, of: { projectId: "project-1" } });

    expect(queryRaw.mock.calls[0]?.[0]?.values).toContain("project-1");
    expect(create).not.toHaveBeenCalled();
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
