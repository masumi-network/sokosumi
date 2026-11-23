import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

import { getEnv } from "@/config/env";
import type { Network } from "@/lib/network";

type CorePrismaClient = ReturnType<typeof createPrismaClient>;

interface CoreDatabase {
  shared: CorePrismaClient;
  /** Built on first use: each client costs about 30 ms to construct. */
  networks: Partial<Record<Network, CorePrismaClient>>;
  createNetworkClient: (network: Network) => CorePrismaClient;
}

const globalForPrisma = globalThis as typeof globalThis & {
  coreDatabase?: CoreDatabase;
};

/**
 * One pool for the `shared` client and the client of each Network. The clients
 * share its connections, so session state set on one is seen by the others:
 * use `SET LOCAL` inside a transaction or schema-qualified names, never a
 * plain `SET` (`no-session-set.test.ts`).
 */
function createCoreDatabase(): CoreDatabase {
  const env = getEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    // pg's default, now shared by all three clients. Preprod stays off until
    // the move, so Mainnet keeps the connections it had; one long transaction
    // on any client holds one of them.
    max: 10,
    // Detect dead TCP connections before the next cron invocation (60s).
    // The OS default (~7200s) misses server-side idle-timeout closures.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  attachDatabasePool(pool);
  // Attached once here: each client given `onPoolError` would add its own
  // listener and report every idle-client error three times.
  pool.on("error", (error) => {
    Sentry.captureException(error, { tags: { context: "database_pool" } });
  });

  const createClient = (schema: string) =>
    createPrismaClient(pool, {
      schema,
      onConnectionError(error) {
        Sentry.captureException(error, {
          tags: { context: "database_connection" },
        });
      },
    });

  const networkSchemas: Record<Network, string> = {
    mainnet: env.DATABASE_SCHEMA_MAINNET,
    preprod: env.DATABASE_SCHEMA_PREPROD,
  };

  return {
    shared: createClient(env.DATABASE_SCHEMA_SHARED),
    networks: {},
    createNetworkClient: (network) => createClient(networkSchemas[network]),
  };
}

const database = globalForPrisma.coreDatabase ?? createCoreDatabase();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.coreDatabase = database;
}

/**
 * The `shared` client: Better Auth, users, Organizations, Tasks. A write that
 * also touches a Network's tables runs in one interactive transaction on this
 * client, with schema-qualified raw SQL for the Network side.
 */
const prisma = database.shared;

/** The client of one Network's schema. */
export function networkPrisma(network: Network): CorePrismaClient {
  database.networks[network] ??= database.createNetworkClient(network);
  return database.networks[network];
}

/** The client or an open transaction: what a helper that only reads or writes takes. */
export type DbClient = Prisma.TransactionClient | typeof prisma;

export default prisma;
