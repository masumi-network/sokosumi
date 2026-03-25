import type { Prisma } from "@sokosumi/database";
import {
  jobWithEvents,
  jobWithPurchase,
  jobWithTransaction,
} from "@sokosumi/database/types/job";

export const taskInclude = {
  events: {
    include: {
      transaction: {
        select: { amount: true },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  },
  jobs: {
    include: {
      ...jobWithEvents,
      ...jobWithTransaction,
      ...jobWithPurchase,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
  linksFrom: {
    orderBy: {
      createdAt: "asc",
    },
  },
  linksTo: {
    orderBy: {
      createdAt: "asc",
    },
  },
} as const;

export type TaskWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;
