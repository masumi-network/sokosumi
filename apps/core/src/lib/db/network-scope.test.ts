import type { Prisma } from "@sokosumi/database";
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

  it("refuses Preprod while Preprod is off, and an unknown Network", async () => {
    const { createNetworkScope } = await import("./network-scope");

    expect(() => createNetworkScope("preprod")).toThrow("Preprod is off");
    expect(() => createNetworkScope("testnet" as Network)).toThrow(
      "Unknown Network",
    );
    expect(networkPrisma).not.toHaveBeenCalled();
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
}
