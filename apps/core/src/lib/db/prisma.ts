import * as Sentry from "@sentry/node";
import { createPrismaClient } from "@sokosumi/database/client";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

import { getEnv } from "@/config/env";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: ReturnType<typeof createPrismaClient>;
};

function createCorePrismaClient() {
  const pool = new Pool({
    connectionString: getEnv().DATABASE_URL,
    // Detect dead TCP connections before the next cron invocation (60s).
    // The OS default (~7200s) misses server-side idle-timeout closures.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  attachDatabasePool(pool);

  return createPrismaClient(pool, {
    onPoolError(error) {
      Sentry.captureException(error, { tags: { context: "database_pool" } });
    },
    onConnectionError(error) {
      Sentry.captureException(error, {
        tags: { context: "database_connection" },
      });
    },
  });
}

const prisma = globalForPrisma.prisma ?? createCorePrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
