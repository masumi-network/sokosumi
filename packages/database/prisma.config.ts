import "dotenv/config";

import type { PrismaConfig } from "prisma/config";

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
