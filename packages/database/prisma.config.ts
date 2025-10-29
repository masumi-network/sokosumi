import "dotenv/config";

import path from "node:path";

import type { PrismaConfig } from "prisma/config";

export default {
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
} satisfies PrismaConfig;
