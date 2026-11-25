import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { configureSqlTables } from "@sokosumi/database/sql-tables";
import { attachDatabasePool } from "@vercel/functions";
import { createError } from "evlog";
import { Pool } from "pg";

import { getEnv } from "@/config/env";
import { isPreprodOn, type Network, requireNetwork } from "@/lib/network";

type CorePrismaClient = ReturnType<typeof createPrismaClient>;

interface CoreDatabase {
  shared: CorePrismaClient;
  /** Built on first use: each client costs about 30 ms to construct. */
  networks: Partial<Record<Network, CorePrismaClient>>;
  createNetworkClient: (network: Network) => CorePrismaClient;
  /** The schema names the clients were built for (`schemaLayoutKey`). */
  schemaLayoutKey: string;
}

function schemaLayoutKey(): string {
  const env = getEnv();
  return [
    env.DATABASE_SCHEMA_SHARED,
    env.DATABASE_SCHEMA_MAINNET,
    env.DATABASE_SCHEMA_PREPROD,
  ].join(",");
}

// The database package's raw SQL names the schemas these clients name. Set on
// every evaluation of this module, before any query can run. A missing name is
// `public`, as for `createPrismaClient`: tests that mock `getEnv` leave them
// out, while `getEnv` itself always fills them.
{
  const env = getEnv();
  configureSqlTables({
    shared: env.DATABASE_SCHEMA_SHARED ?? "public",
    mainnet: env.DATABASE_SCHEMA_MAINNET ?? "public",
    preprod: env.DATABASE_SCHEMA_PREPROD ?? "public",
    preprodOn: env.NETWORK_PREPROD_ENABLED === true,
  });
}

const globalForPrisma = globalThis as typeof globalThis & {
  coreDatabase?: CoreDatabase;
};

/**
 * One pool for the `shared` client and the client of each Network. The clients
 * share its connections, so session state set on one is seen by the others:
 * name schemas in raw SQL and never set the search path
 * (`__tests__/no-session-set.test.ts`).
 */
function createCoreDatabase(): CoreDatabase {
  const env = getEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    // Shared by all three clients: while Preprod is off, Mainnet has all of
    // them; one long transaction on any client holds one. Kept at 10 with
    // Preprod on: this is per instance, Vercel adds instances under load, and
    // a larger pool multiplies connections to Neon's pooler. Preprod is
    // testing traffic. shortcut: no measurement; raise it, or give Preprod a
    // smaller pool of its own, if P2024 pool timeouts show up with Preprod on.
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
    schemaLayoutKey: schemaLayoutKey(),
  };
}

// The development cache outlives a module reload, which may bring other schema
// names; clients built for the old names would query the wrong schemas.
const cached = globalForPrisma.coreDatabase;
const database =
  cached?.schemaLayoutKey === schemaLayoutKey() ? cached : createCoreDatabase();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.coreDatabase = database;
}

/**
 * The `shared` client: Better Auth, users, Organizations, Tasks. A write that
 * also touches a Network's tables runs in one interactive transaction on this
 * client, with schema-qualified raw SQL for the Network side.
 */
const prisma = database.shared;

/**
 * The client of one Network's schema. Throws for Preprod while Preprod is off:
 * on today's layout its schema is Mainnet's.
 */
export function networkPrisma(network: Network): CorePrismaClient {
  const known = requireNetwork(network);
  if (known === "preprod" && !isPreprodOn()) {
    throw createError({
      message: "Preprod is off: NETWORK_PREPROD_ENABLED is not true",
      why: "A caller asked for the Preprod client while Preprod is off",
      fix: "Check isPreprodOn() before asking for the Preprod client",
    });
  }
  database.networks[known] ??= database.createNetworkClient(known);
  return database.networks[known];
}

/** The client or an open transaction: what a helper that only reads or writes takes. */
export type DbClient = Prisma.TransactionClient | typeof prisma;

export default prisma;
