import "dotenv/config";

import type { PrismaConfig } from "prisma/config";

import {
  checkMigrateDeployEnv,
  isDbMutatingPrismaCommand,
} from "./src/helpers/migrate-deploy-preflight.js";

// Preflight only DB-mutating CLI commands (`migrate …`, `db …`): Preview
// without DATABASE_URL_UNPOOLED fails closed so a raw `prisma migrate deploy`
// cannot fall back to a shared/production DATABASE_URL. No-DB commands like
// `prisma generate` (this package's prepare script) skip it: they have
// nothing to guard and must not fail installs/builds.
const preflight = isDbMutatingPrismaCommand(process.argv)
  ? checkMigrateDeployEnv({
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    })
  : { ok: true as const, messages: [] };

for (const message of preflight.messages) {
  const prefix =
    message.level === "error" ? "[prisma] error:" : "[prisma] warning:";
  const write = message.level === "error" ? console.error : console.warn;
  write(`${prefix} ${message.text}`);
}

if (!preflight.ok) {
  throw new Error(
    preflight.messages.map((message) => message.text).join("\n") ||
      "Prisma config preflight failed",
  );
}

export default {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prefer non-pooler URL for migrate deploy (Neon DDL via PgBouncer fails).
    // Vercel Neon integration injects DATABASE_URL_UNPOOLED automatically
    // (Production + per-preview branches). Fall back to DATABASE_URL for
    // local/dev. Placeholder only for prisma generate.
    url:
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.DATABASE_URL ||
      "postgresql://user:password@localhost:5432/sokosumi?schema=public",
  },
} satisfies PrismaConfig;
