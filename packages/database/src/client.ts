import { PrismaPg } from "@prisma/adapter-pg";
import type { Pool } from "pg";

import { PrismaClient } from "./generated/prisma/client.js";

/**
 * Connection strings use TCP keepalive (initial delay 10s).
 * Supplied pools retain caller-owned configuration and lifetime.
 */
export function createPrismaClient(
  poolOrUrl: string | Pool,
  options?: PrismaClientPoolOptions,
): PrismaClient {
  const adapter = new PrismaPg(
    typeof poolOrUrl === "string"
      ? {
          connectionString: poolOrUrl,
          // Detect dead TCP connections before the next query hits them.
          // Without this, a server-side idle-timeout closure looks like
          // "server conn crashed?" mid-transaction in serverless runtimes.
          // keepAliveInitialDelayMillis must be set explicitly: the OS default
          // (tcp_keepalive_time, typically 7200 s on Linux) is far longer than
          // the 60 s between cron invocations, so probes would never fire in time.
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
        }
      : poolOrUrl,
    options,
  );
  return new PrismaClient({ adapter });
}

export interface PrismaClientPoolOptions {
  onPoolError?: (error: Error) => void;
  onConnectionError?: (error: Error) => void;
}

/**
 * Client-side Prisma namespace, re-exported for parameterised raw SQL.
 *
 * The package root re-exports the *browser* namespace, which deliberately has
 * no `sql`/`empty` tag — importing that in a raw query fails at type-check.
 */
export { Prisma as PrismaRaw } from "./generated/prisma/client.js";
