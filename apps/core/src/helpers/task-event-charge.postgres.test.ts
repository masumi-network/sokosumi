/**
 * Real-Postgres proof of the Task charge: who it is booked to (ADR 0057), and
 * that it runs through a Network scope (ADR 0081): the rows of its Network,
 * written in raw SQL on a transaction of the shared side.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/helpers/task-event-charge.postgres.test.ts
 *
 * The Owner is the transaction's member and spends what they can spend in
 * the Organization. Work without an Owner draws on the Organization pool with
 * no member. The bucket scope is SQL, so only a real
 * database proves the charge lands on the right buckets. Fixtures are
 * committed, because the two sides have a client each, and deleted after
 * each test.
 */
import { randomUUID } from "node:crypto";
import { TaskStatus } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import type { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { NetworkScope, SharedDb } from "@/lib/db/network-scope";
import { NETWORKS, type Network } from "@/lib/network";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const pools = vi.hoisted(() => [] as Pool[]);
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    attachDatabasePool: (pool: Pool) => {
      pools.push(pool);
      actual.attachDatabasePool(pool);
    },
  };
});
// setup.ts mocks this module for every file: the scope needs the real clients.
vi.unmock("@/lib/db/prisma");

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");

const CREDIT = 10n ** 10n;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Client = ReturnType<typeof createPrismaClient>;

/**
 * Only on the split layout, and only until the trigger bodies name their
 * schemas (the triggers' own ticket): `history_transaction_sync` on
 * `Transaction` reads `"Job"` and `"taskEvent"` by bare name, so no insert
 * there succeeds on Core's connections. The test gives its fixture clients and
 * its own transactions the search path those bodies need, and nothing more:
 * the bucket query has no trigger and is tested without it below. That the
 * two inserts name their schema is proven by the prepare step
 * (`scripts/prepare-raw-sql.ts`, which runs on `public` only), not by these
 * tests, which would resolve a bare name through this path.
 */
function triggerSearchPath(side: "shared" | Network): string | null {
  if (!onSplitLayout) return null;
  const schemas = testSchemaNames();
  const shared = schemas.DATABASE_SCHEMA_SHARED;
  if (side === "shared") return shared;
  const own =
    side === "mainnet"
      ? schemas.DATABASE_SCHEMA_MAINNET
      : schemas.DATABASE_SCHEMA_PREPROD;
  return `${own},${shared}`;
}

/** Past Core's clients, one per side, built on first use. */
const admins = new Map<string, Client>();
function admin(side: "shared" | Network): Client {
  const schemas = testSchemaNames();
  const schema = {
    shared: schemas.DATABASE_SCHEMA_SHARED,
    mainnet: schemas.DATABASE_SCHEMA_MAINNET,
    preprod: schemas.DATABASE_SCHEMA_PREPROD,
  }[side];
  const fixtureUrl = new URL(url ?? "");
  const searchPath = triggerSearchPath(side);
  if (searchPath)
    fixtureUrl.searchParams.set("options", `-c search_path=${searchPath}`);
  const client =
    admins.get(side) ?? createPrismaClient(fixtureUrl.href, { schema });
  admins.set(side, client);
  return client;
}

/**
 * The charge and the scope as a fresh start of Core loads them, with Preprod
 * on where the layout has it.
 */
async function start() {
  delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
  vi.resetModules();
  vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : undefined);
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  const charge = await import("./task-event-charge");
  // The repository of this start: its table names follow the fresh config.
  const { creditBucketRepository: repository } = await import(
    "@sokosumi/database/repositories"
  );
  return { createNetworkScope, repository, ...charge };
}

interface SeededPool {
  userId: string;
  organizationId: string;
  smallBucketId: string;
  largeBucketId: string;
}

const seeded: SeededPool[] = [];

/**
 * A free Organization with one member, and in each given Network a pool of
 * 3 credits and the given large bucket, under the same bucket ids. The small
 * bucket is spent first.
 */
async function seedOrganizationPool(
  largeBucketCredits: Partial<Record<Network, bigint>> = { mainnet: 10n },
): Promise<SeededPool> {
  const key = randomUUID();
  const pool: SeededPool = {
    userId: `tcharge-user-${key}`,
    organizationId: `tcharge-org-${key}`,
    smallBucketId: `tcharge-small-${key}`,
    largeBucketId: `tcharge-large-${key}`,
  };
  seeded.push(pool);
  await admin("shared").user.create({
    data: {
      id: pool.userId,
      name: "Charge User",
      email: `tcharge-${key}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await admin("shared").organization.create({
    data: {
      id: pool.organizationId,
      name: "Charge Org",
      slug: `tcharge-org-${key}`,
      members: { create: { userId: pool.userId, role: "member" } },
    },
  });
  for (const network of NETWORKS) {
    const large = largeBucketCredits[network];
    if (large === undefined) continue;
    for (const [id, credits] of [
      [pool.smallBucketId, 3n],
      [pool.largeBucketId, large],
    ] as const) {
      const topUp = await admin(network).transaction.create({
        data: {
          amount: credits * CREDIT,
          organizationId: pool.organizationId,
        },
        select: { id: true },
      });
      await admin(network).creditBucket.create({
        data: {
          id,
          amount: credits * CREDIT,
          organizationId: pool.organizationId,
          sourceTransactionId: topUp.id,
        },
      });
    }
  }
  return pool;
}

/** The spends booked to the pool's Organization in a Network, with their consumptions. */
async function spends(network: Network, pool: SeededPool) {
  return await admin(network).transaction.findMany({
    where: { organizationId: pool.organizationId, amount: { lt: 0n } },
    include: { creditConsumptions: { orderBy: { amount: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Every column of a row but `id` and the timestamps, with the fixture's ids
 * replaced by their role, so rows of two equal pools compare.
 */
function comparable(row: Record<string, unknown>, pool: SeededPool) {
  const roles = new Map<unknown, string>([
    [pool.userId, "user"],
    [pool.organizationId, "organization"],
    [pool.smallBucketId, "small bucket"],
    [pool.largeBucketId, "large bucket"],
  ]);
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = row;
  return Object.fromEntries(
    Object.entries(rest).map(([column, value]) => [
      column,
      roles.get(value) ?? value,
    ]),
  );
}

/** The pool's one spend and its consumptions: every column the models declare. */
async function comparableSpend(pool: SeededPool) {
  const [spend, ...none] = await spends("mainnet", pool);
  expect(none).toEqual([]);
  const { creditConsumptions = [], ...transaction } = spend ?? {};
  return {
    transaction: comparable(transaction, pool),
    consumptions: creditConsumptions.map(({ transactionId, ...row }) => ({
      ...comparable(row, pool),
      ofItsTransaction: transactionId === spend?.id,
    })),
  };
}

/**
 * The charge as `main` wrote it before the Network scope: one nested create
 * through the models, on the transaction that chose the buckets. Kept here as
 * the baseline the raw inserts must equal.
 */
async function chargeAsBefore(pool: SeededPool, cents: bigint) {
  await admin("mainnet").$transaction(async (tx) => {
    const consumptions = await creditBucketRepository.prepareConsumption(
      "mainnet",
      pool.userId,
      pool.organizationId,
      cents,
      tx,
      { projectId: null },
    );
    await tx.transaction.create({
      data: {
        amount: cents * BigInt(-1),
        user: { connect: { id: pool.userId } },
        organization: { connect: { id: pool.organizationId } },
        creditConsumptions: {
          createMany: {
            data: consumptions.map((consumption) => ({
              bucketId: consumption.bucketId,
              amount: consumption.amount,
            })),
          },
        },
      },
      select: { id: true },
    });
  });
}

function chargeArgs(pool: SeededPool, credits: bigint) {
  return {
    userId: pool.userId,
    organizationId: pool.organizationId,
    projectId: null,
    cents: credits * CREDIT,
    currentStatus: TaskStatus.RUNNING,
  };
}

async function organizationName(pool: SeededPool) {
  const organization = await admin("shared").organization.findUniqueOrThrow({
    where: { id: pool.organizationId },
    select: { name: true },
  });
  return organization.name;
}

afterEach(async () => {
  for (const pool of seeded.splice(0)) {
    for (const network of ["mainnet", "preprod"] as const) {
      if (network === "preprod" && !onSplitLayout) continue;
      const where = { organizationId: pool.organizationId };
      await admin(network).creditBucket.deleteMany({ where });
      await admin(network).transaction.deleteMany({ where });
    }
    await admin("shared").organization.delete({
      where: { id: pool.organizationId },
    });
    await admin("shared").user.delete({ where: { id: pool.userId } });
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const client of admins.values()) await client.$disconnect();
  await Promise.all(pools.map((pool) => pool.end()));
});

/** A transaction of the shared side, as the charge's callers open it. */
function charged<T>(scope: NetworkScope, run: (tx: SharedDb) => Promise<T>) {
  const searchPath = triggerSearchPath(scope.network);
  return scope.sharedTransaction(async (tx) => {
    if (searchPath)
      await tx.$executeRaw`SELECT set_config('search_path', ${searchPath}, true)`;
    return await run(tx);
  }, "Charge test conflict");
}

describe.skipIf(!enabled)("chargeTaskCreditsOrMarkOutOfCredits", () => {
  it("books the Owner as the transaction's member", async () => {
    const { createNetworkScope, chargeTaskCreditsOrMarkOutOfCredits } =
      await start();
    const scope = createNetworkScope("mainnet");
    const pool = await seedOrganizationPool();

    const charge = await charged(scope, (tx) =>
      chargeTaskCreditsOrMarkOutOfCredits({
        ...chargeArgs(pool, 2n),
        scope,
        tx,
      }),
    );

    const [transaction, ...others] = await spends("mainnet", pool);
    expect(others).toEqual([]);
    expect(transaction).toMatchObject({
      id: charge.transactionId,
      userId: pool.userId,
      organizationId: pool.organizationId,
      amount: -2n * CREDIT,
    });
    expect(transaction?.creditConsumptions).toEqual([
      expect.objectContaining({
        bucketId: pool.smallBucketId,
        amount: 2n * CREDIT,
      }),
    ]);
  });

  it("charges work without an Owner to the Organization pool with no member", async () => {
    const { createNetworkScope, chargeTaskCreditsOrMarkOutOfCredits } =
      await start();
    const scope = createNetworkScope("mainnet");
    const pool = await seedOrganizationPool();

    const charge = await charged(scope, (tx) =>
      chargeTaskCreditsOrMarkOutOfCredits({
        ...chargeArgs(pool, 3n),
        userId: null,
        scope,
        tx,
      }),
    );

    expect(charge.eventStatus).toBeNull();
    const [transaction] = await spends("mainnet", pool);
    expect(transaction).toMatchObject({
      id: charge.transactionId,
      userId: null,
      organizationId: pool.organizationId,
      amount: -3n * CREDIT,
    });
    expect(transaction?.creditConsumptions).toEqual([
      expect.objectContaining({
        bucketId: pool.smallBucketId,
        amount: 3n * CREDIT,
      }),
    ]);
  });

  it("pauses work without an Owner when the Organization pool runs dry", async () => {
    const { createNetworkScope, chargeTaskCreditsOrMarkOutOfCredits } =
      await start();
    const scope = createNetworkScope("mainnet");
    const pool = await seedOrganizationPool();

    const charge = await charged(scope, (tx) =>
      chargeTaskCreditsOrMarkOutOfCredits({
        ...chargeArgs(pool, 14n),
        userId: null,
        scope,
        tx,
      }),
    );

    expect(charge).toEqual({
      transactionId: null,
      eventStatus: TaskStatus.OUT_OF_CREDITS,
    });
    expect(await spends("mainnet", pool)).toEqual([]);
  });

  it("refuses a charge above the balance with the same 422, and the transaction goes on", async () => {
    const { createNetworkScope, chargeTaskCreditsOrMarkOutOfCredits } =
      await start();
    const scope = createNetworkScope("mainnet");
    const pool = await seedOrganizationPool();

    const error = await charged(scope, async (tx) => {
      const refused = await chargeTaskCreditsOrMarkOutOfCredits({
        ...chargeArgs(pool, 14n),
        // A finished Task is not paused: the charge's own error comes out.
        currentStatus: TaskStatus.COMPLETED,
        scope,
        tx,
      }).catch((error: unknown) => error);
      // Image Studio keeps writing after a shortfall.
      await tx.organization.update({
        where: { id: pool.organizationId },
        data: { name: "Written after the refusal" },
      });
      return refused;
    });

    expect(error).toMatchObject({
      status: 422,
      message: `Insufficient balance: tried to consume ${14n * CREDIT} but only ${13n * CREDIT} available`,
      cause: { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
    });
    expect(await spends("mainnet", pool)).toEqual([]);
    expect(await organizationName(pool)).toBe("Written after the refusal");
  });

  // The nested create needs both sides on one client: today's layout only.
  it.skipIf(onSplitLayout)(
    "writes the rows the nested create wrote, column by column",
    async () => {
      const { createNetworkScope, chargeTaskCreditsOrMarkOutOfCredits } =
        await start();
      const scope = createNetworkScope("mainnet");
      const before = await seedOrganizationPool();
      const now = await seedOrganizationPool();

      // 4 credits: the small bucket whole and one credit of the large one.
      await chargeAsBefore(before, 4n * CREDIT);
      const startedAt = Date.now();
      const charge = await charged(scope, (tx) =>
        chargeTaskCreditsOrMarkOutOfCredits({
          ...chargeArgs(now, 4n),
          scope,
          tx,
        }),
      );
      const endedAt = Date.now();

      const written = await comparableSpend(now);
      expect(written).toEqual(await comparableSpend(before));
      expect(written).toEqual({
        transaction: {
          amount: -4n * CREDIT,
          userId: "user",
          organizationId: "organization",
        },
        consumptions: [
          {
            amount: 1n * CREDIT,
            bucketId: "large bucket",
            ofItsTransaction: true,
          },
          {
            amount: 3n * CREDIT,
            bucketId: "small bucket",
            ofItsTransaction: true,
          },
        ],
      });
      // What the comparison leaves out, by its form: ids are UUID v7 and the
      // timestamps one instant of this process, as Prisma set them.
      const [transaction] = await spends("mainnet", now);
      const [old] = await spends("mainnet", before);
      for (const row of [transaction, old]) {
        expect(row?.id).toMatch(UUID_V7);
        expect(row?.updatedAt).toEqual(row?.createdAt);
        for (const consumption of row?.creditConsumptions ?? []) {
          expect(consumption.id).toMatch(UUID_V7);
          expect(consumption.createdAt).toEqual(row?.createdAt);
        }
      }
      expect(transaction?.id).toBe(charge.transactionId);
      expect(transaction?.createdAt.getTime()).toBeGreaterThanOrEqual(
        startedAt,
      );
      expect(transaction?.createdAt.getTime()).toBeLessThanOrEqual(endedAt);
      const ids = transaction?.creditConsumptions.map(({ id }) => id) ?? [];
      expect(new Set([transaction?.id, ...ids]).size).toBe(3);
    },
  );

  it("rolls the credit rows back with the shared side", async () => {
    const { createNetworkScope, chargeTaskCreditsOrMarkOutOfCredits } =
      await start();
    const scope = createNetworkScope("mainnet");
    const pool = await seedOrganizationPool();
    const charge = (tx: SharedDb) =>
      chargeTaskCreditsOrMarkOutOfCredits({
        ...chargeArgs(pool, 2n),
        scope,
        tx,
      });

    // A failure after the Network inserts takes the shared write with it.
    await expect(
      charged(scope, async (tx) => {
        await tx.organization.update({
          where: { id: pool.organizationId },
          data: { name: "Rolled back" },
        });
        expect((await charge(tx)).transactionId).toMatch(UUID_V7);
        throw new Error("after the charge");
      }),
    ).rejects.toThrow("after the charge");
    expect(await spends("mainnet", pool)).toEqual([]);
    expect(await organizationName(pool)).toBe("Charge Org");

    // A failing write on the shared side leaves no credit row.
    await expect(
      charged(scope, async (tx) => {
        await charge(tx);
        await tx.organization.create({
          data: {
            id: pool.organizationId,
            name: "Twice",
            slug: "tcharge-twice",
          },
        });
      }),
    ).rejects.toThrow();
    expect(await spends("mainnet", pool)).toEqual([]);
  });

  describe.runIf(onSplitLayout)("on the split layout", () => {
    it("chooses each Network's buckets on a connection with no search path", async () => {
      const { createNetworkScope, repository } = await start();
      const pool = await seedOrganizationPool({ mainnet: 10n, preprod: 5n });
      // Core's own shared client, as it is: no search path, no transaction.
      const { sharedDb } = createNetworkScope("mainnet");
      const choose = (network: Network, credits: bigint) =>
        repository.prepareConsumption(
          network,
          pool.userId,
          pool.organizationId,
          credits * CREDIT,
          sharedDb,
        );

      expect(await choose("preprod", 8n)).toEqual([
        { bucketId: pool.smallBucketId, amount: 3n * CREDIT },
        { bucketId: pool.largeBucketId, amount: 5n * CREDIT },
      ]);
      await expect(choose("preprod", 9n)).rejects.toThrow(
        "Insufficient balance",
      );
      expect(await choose("mainnet", 13n)).toEqual([
        { bucketId: pool.smallBucketId, amount: 3n * CREDIT },
        { bucketId: pool.largeBucketId, amount: 10n * CREDIT },
      ]);
    });

    it("records a Preprod charge at its price without pausing the Task, and charges Mainnet under the same ids", async () => {
      const { createNetworkScope, chargeTaskCreditsOrMarkOutOfCredits } =
        await start();
      // Preprod buckets that hold 8 credits: Preprod costs none, so they stay.
      const pool = await seedOrganizationPool({ mainnet: 10n, preprod: 5n });
      const preprod = createNetworkScope("preprod");
      const mainnet = createNetworkScope("mainnet");
      const chargeOn = (scope: NetworkScope, credits: bigint) =>
        charged(scope, (tx) =>
          chargeTaskCreditsOrMarkOutOfCredits({
            ...chargeArgs(pool, credits),
            scope,
            tx,
          }),
        );

      // More than Preprod's buckets hold: recorded, never out of credits, so
      // no Task waits for a Preprod payment and no grant can wake one.
      const recorded = await chargeOn(preprod, 9n);

      expect(recorded.eventStatus).toBeNull();
      expect(await spends("mainnet", pool)).toEqual([]);
      expect(await spends("preprod", pool)).toEqual([
        expect.objectContaining({
          id: recorded.transactionId,
          amount: -9n * CREDIT,
          creditConsumptions: [],
        }),
      ]);

      await chargeOn(mainnet, 13n);
      expect(await spends("mainnet", pool)).toMatchObject([
        {
          amount: -13n * CREDIT,
          creditConsumptions: [
            { bucketId: pool.smallBucketId, amount: 3n * CREDIT },
            { bucketId: pool.largeBucketId, amount: 10n * CREDIT },
          ],
        },
      ]);
      expect(await spends("preprod", pool)).toHaveLength(1);
    });
  });
});
