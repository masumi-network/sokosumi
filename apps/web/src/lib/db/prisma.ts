import "server-only";

import { createPrismaClient } from "@sokosumi/database/client";

import { getEnvSecrets } from "@/config/env.secrets";

const globalForPrisma = global as unknown as {
  prisma: ReturnType<typeof createPrismaClient>;
};

const prisma =
  globalForPrisma.prisma || createPrismaClient(getEnvSecrets().DATABASE_URL);

// eslint-disable-next-line no-restricted-properties
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
