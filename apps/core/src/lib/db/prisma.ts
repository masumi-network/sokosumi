import { createPrismaClient } from "@sokosumi/database/client";

import { getEnv } from "@/config/env";

const globalForPrisma = global as unknown as {
  prisma: ReturnType<typeof createPrismaClient>;
};

const prisma =
  globalForPrisma.prisma || createPrismaClient(getEnv().DATABASE_URL);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
