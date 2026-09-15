import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

/**
 * Prisma client with TCP keepAlive (initial delay 10s).
 * OS default keepalive is ~7200s, longer than cron idle gaps, so probes would never fire in time.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    // Detect dead TCP connections before the next query hits them.
    // Without this, a server-side idle-timeout closure looks like
    // "server conn crashed?" mid-transaction in serverless runtimes.
    // keepAliveInitialDelayMillis must be set explicitly: the OS default
    // (tcp_keepalive_time, typically 7200 s on Linux) is far longer than
    // the 60 s between cron invocations, so probes would never fire in time.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}

/**
 * Client-side Prisma namespace, re-exported for parameterised raw SQL.
 *
 * The package root re-exports the *browser* namespace, which deliberately has
 * no `sql`/`empty` tag — importing that in a raw query fails at type-check.
 */
export { Prisma as PrismaRaw } from "./generated/prisma/client.js";
