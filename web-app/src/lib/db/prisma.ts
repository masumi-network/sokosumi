import {
  CreditTransaction,
  Prisma,
  PrismaClient,
} from "@/prisma/generated/client";

import { creditTransactionType } from "./utils/credit.utils";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    transactionOptions: {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  }).$extends({
    model: {
      creditTransaction: {
        type: {
          compute(creditTransaction: CreditTransaction) {
            return creditTransactionType(creditTransaction);
          },
        },
      },
    },
  });

// eslint-disable-next-line no-restricted-properties
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
