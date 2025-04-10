import { Prisma, PrismaClient } from "@/prisma/generated/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    transactionOptions: {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  });

// eslint-disable-next-line no-restricted-properties
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
