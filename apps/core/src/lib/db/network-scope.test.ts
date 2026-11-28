import { Prisma } from "@sokosumi/database";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import type { Network } from "@/lib/network";

import type { NetworkDb, NetworkScope, SharedDb } from "./network-scope";

type DefaultClient = typeof import("./prisma").default;

const clients = vi.hoisted(() => ({
  shared: { side: "shared" },
  mainnet: { side: "mainnet" },
}));
const networkPrisma = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/prisma", () => ({ default: clients.shared, networkPrisma }));

afterEach(() => {
  networkPrisma.mockReset();
});

describe("createNetworkScope", () => {
  it("hands out the Network, the shared client and the Network's client itself", async () => {
    const { createNetworkScope } = await import("./network-scope");
    networkPrisma.mockReturnValue(clients.mainnet);

    const scope = createNetworkScope("mainnet");

    expect(scope.network).toBe("mainnet");
    expect(scope.sharedDb).toBe(clients.shared);
    expect(scope.networkDb).toBe(clients.mainnet);
    expect(networkPrisma).toHaveBeenCalledExactlyOnceWith("mainnet");
  });

  it("asks for no client until networkDb is read", async () => {
    const { createNetworkScope } = await import("./network-scope");

    const scope = createNetworkScope("mainnet");
    void scope.sharedDb;
    scope.networkTable("Job");

    expect(networkPrisma).not.toHaveBeenCalled();
  });

  it("works on a client module mocked with a default export only, until networkDb is read", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/prisma", () => ({ default: clients.shared }));
    onTestFinished(() => {
      vi.doMock("@/lib/db/prisma", () => ({
        default: clients.shared,
        networkPrisma,
      }));
      vi.resetModules();
    });
    const { createNetworkScope } = await import("./network-scope");

    const scope = createNetworkScope("mainnet");

    expect(scope.sharedDb).toBe(clients.shared);
    expect(() => scope.networkDb).toThrow("networkPrisma");
  });

  it("names its own Network's schema in raw SQL", async () => {
    const { createNetworkScope } = await import("./network-scope");

    expect(createNetworkScope("mainnet").networkTable("Job").sql).toBe(
      '"public"."Job"',
    );
  });

  it("returns a registry conflict on the first attempt with its full upsert timeout", async () => {
    const { createNetworkScope } = await import("./network-scope");
    const conflict = Object.assign(new Error("lost"), { code: "P2034" });
    const $transaction = vi.fn().mockRejectedValue(conflict);
    networkPrisma.mockReturnValue({ $transaction });
    const scope = createNetworkScope("mainnet");

    await expect(
      scope.netTransactionOnce(async () => {}, { timeout: 20_000 }),
    ).rejects.toBe(conflict);
    expect($transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      timeout: 20_000,
    });
  });

  it("opens a Network transaction on the Network's client, with the retry", async () => {
    const { createNetworkScope } = await import("./network-scope");
    const tx = { side: "mainnet transaction" };
    const $transaction = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("lost"), { code: "P2034" }),
      )
      .mockImplementation((run: (tx: unknown) => unknown) => run(tx));
    networkPrisma.mockReturnValue({ $transaction });
    const callback = vi.fn().mockResolvedValue("result");

    const result = await createNetworkScope("mainnet").netTransaction(
      callback,
      "Conflict message",
      Prisma.TransactionIsolationLevel.Serializable,
    );

    expect(result).toBe("result");
    expect(networkPrisma).toHaveBeenCalledExactlyOnceWith("mainnet");
    expect($transaction).toHaveBeenCalledTimes(2);
    expect($transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(callback).toHaveBeenCalledExactlyOnceWith(tx);
  });

  it("reads a batch in one transaction on the Network's client", async () => {
    const { createNetworkScope } = await import("./network-scope");
    const $transaction = vi.fn().mockResolvedValue(["rows", 2]);
    const client = { $transaction, tag: { findMany: vi.fn(() => "find") } };
    networkPrisma.mockReturnValue(client);

    const result = await createNetworkScope("mainnet").netBatch(
      (db) => [db.tag.findMany()],
      Prisma.TransactionIsolationLevel.RepeatableRead,
    );

    expect(result).toEqual(["rows", 2]);
    expect(networkPrisma).toHaveBeenCalledExactlyOnceWith("mainnet");
    expect($transaction).toHaveBeenCalledExactlyOnceWith(["find"], {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it("refuses Preprod while Preprod is off, and an unknown Network", async () => {
    const { createNetworkScope } = await import("./network-scope");

    expect(() => createNetworkScope("preprod")).toThrow("Preprod is off");
    expect(() => createNetworkScope("testnet" as Network)).toThrow(
      "Unknown Network",
    );
    expect(networkPrisma).not.toHaveBeenCalled();
  });
});

describe("assertMainnetScope", () => {
  it("passes Mainnet's scope and throws for any other", async () => {
    const {
      assertMainnetScope,
      createNetworkScope,
      createRefusedNetworkScope,
    } = await import("./network-scope");
    const refusal = new Error("refused");

    expect(() =>
      assertMainnetScope(createNetworkScope("mainnet")),
    ).not.toThrow();
    expect(() =>
      assertMainnetScope({ network: "preprod" } as NetworkScope),
    ).toThrow("Expected the Mainnet scope, got preprod's");
    expect(() =>
      assertMainnetScope(createRefusedNetworkScope(refusal)),
    ).toThrow(refusal);
  });
});

describe("createRefusedNetworkScope", () => {
  it("throws the refusal on every Network member and serves the shared side", async () => {
    const { createRefusedNetworkScope } = await import("./network-scope");
    const refusal = new Error("refused");

    const scope = createRefusedNetworkScope(refusal);

    expect(() => scope.network).toThrow(refusal);
    expect(() => scope.networkDb).toThrow(refusal);
    expect(() => scope.networkTable("Job")).toThrow(refusal);
    await expect(
      scope.netTransaction(async () => "ran", "conflict"),
    ).rejects.toBe(refusal);
    await expect(scope.netBatch(() => [])).rejects.toBe(refusal);
    expect(scope.sharedDb).toBe(clients.shared);
    expect(networkPrisma).not.toHaveBeenCalled();
  });

  it("opens a shared transaction on the shared client", async () => {
    const { createRefusedNetworkScope } = await import("./network-scope");
    const $transaction = vi.fn((run: (tx: unknown) => unknown) => run("tx"));
    Object.assign(clients.shared, { $transaction });
    onTestFinished(() => {
      Reflect.deleteProperty(clients.shared, "$transaction");
    });

    const result = await createRefusedNetworkScope(
      new Error("refused"),
    ).sharedTransaction(async (tx) => `ran on ${String(tx)}`, "conflict");

    expect(result).toBe("ran on tx");
    expect($transaction).toHaveBeenCalledOnce();
  });
});

/**
 * Never called: `tsc` checks it. Each `@ts-expect-error` is a use that must
 * not compile, so loosening a type fails the typecheck here.
 */
export function _wrongSidesDoNotCompile(
  networkDb: NetworkDb,
  sharedDb: SharedDb,
  legacy: Prisma.TransactionClient,
  defaultClient: DefaultClient,
  scope: NetworkScope,
) {
  const takesNetworkDb = (_db: NetworkDb) => {};
  const takesSharedDb = (_db: SharedDb) => {};

  networkDb.job.findMany();
  networkDb.$queryRaw`SELECT 1`;
  sharedDb.user.findMany();
  // The legacy client keeps both sides, and is accepted as the shared side.
  legacy.job.findMany();
  legacy.user.findMany();
  takesSharedDb(legacy);
  defaultClient.job.findMany();
  defaultClient.user.findMany();
  takesSharedDb(defaultClient);
  scope.networkTable("Job");

  // @ts-expect-error the default client is not a Network client: it has no brand
  takesNetworkDb(defaultClient);
  // @ts-expect-error a shared table is not a table of the Network
  scope.networkTable("user");

  // @ts-expect-error a shared model on the Network side
  networkDb.user.findMany();
  // @ts-expect-error a Network model on the shared side
  sharedDb.job.findMany();
  // @ts-expect-error the legacy client is not a Network client: it has no brand
  takesNetworkDb(legacy);
  const picked = legacy as Pick<
    Prisma.TransactionClient,
    Exclude<keyof NetworkDb, symbol>
  >;
  // @ts-expect-error a `Pick` of the legacy client has no brand either
  takesNetworkDb(picked);
  // @ts-expect-error the shared side is not the Network side
  takesNetworkDb(sharedDb);
  // @ts-expect-error neither side opens a transaction itself
  void networkDb.$transaction;
  // @ts-expect-error neither side opens a transaction itself
  void sharedDb.$transaction;

  // A transaction from the scope is narrowed like its clients.
  void scope.netTransaction(async (tx) => {
    takesNetworkDb(tx);
    // @ts-expect-error a shared model in a Network transaction
    await tx.user.findMany();
  }, "conflict");
  void scope.sharedTransaction(async (tx) => {
    takesSharedDb(tx);
    // @ts-expect-error a Network model in a shared-side transaction
    await tx.job.findMany();
    // @ts-expect-error a shared-side transaction is not the Network side
    takesNetworkDb(tx);
  }, "conflict");
}
