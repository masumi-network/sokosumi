import "dotenv/config";
import type { PrismaConfig } from "prisma/config";
import { env } from "prisma/config";

export default {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use placeholder URL for generate if DATABASE_URL is not available
    // Prisma generate doesn't connect to the database, it only validates the URL format
    url: env('DATABASE_URL') || "postgresql://user:password@localhost:5432/sokosumi?schema=public",
  }
} satisfies PrismaConfig;
