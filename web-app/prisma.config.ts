import "dotenv/config";

import path from "node:path";

import type { PrismaConfig } from "prisma/config";
import { env } from "prisma/config";

export default {
  experimental: {
    adapter: true,
  },
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx ./prisma/seed.ts",
  },
  engine: "js",
  adapter: async () => {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    return new PrismaPg({ connectionString: env("DATABASE_URL") });
  },
} satisfies PrismaConfig;
