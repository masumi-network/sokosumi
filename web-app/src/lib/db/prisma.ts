import { PrismaClient } from "@/prisma/generated/client";

import { JobStatus } from "./job/types";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient().$extends({
    result: {
      job: {
        status: {
          compute(job) {
            console.log("job", job);
            return JobStatus.COMPLETED;
          },
        },
      },
    },
  });

// eslint-disable-next-line no-restricted-properties
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
