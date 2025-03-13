import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

// This prevents multiple instances during hot reloading
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
