import type { Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import type { MainnetScope } from "@/lib/db/network-scope";

import { writeOff } from "./write-off";

const scope = { network: "mainnet" } as MainnetScope;

function writeOffTx(left: { id: string; remaining: bigint }[]) {
  const queryRaw = vi.fn().mockResolvedValue(
    left.map((bucket) => ({
      ...bucket,
      organizationId: "org-1",
      userId: null,
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
