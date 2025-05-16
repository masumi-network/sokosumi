import { PrismaClient } from "@/prisma/generated/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const prisma = globalForPrisma.prisma || new PrismaClient();

// eslint-disable-next-line no-restricted-properties
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
