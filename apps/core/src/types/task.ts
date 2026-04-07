import { type Prisma, workspaceRelationInclude } from "@sokosumi/database";
import {
  jobWithEvents,
  jobWithPurchase,
  jobWithTransaction,
} from "@sokosumi/database/types/job";

import type { AuthenticationContext } from "@/middleware/auth";
import {
  buildVisibleTaskLinksInclude,
  taskLinksInclude,
} from "@/types/task-link";

const taskBaseInclude = {
  user: {
    select: {
      id: true,
      name: true,
      image: true,
    },
  },
  ...workspaceRelationInclude,
  events: {
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
        },
      },
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
      ...workspaceRelationInclude,
      ...jobWithEvents,
      ...jobWithTransaction,
      ...jobWithPurchase,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
} as const;

export const taskListInclude = taskBaseInclude;

export const taskInclude = {
  ...taskBaseInclude,
  share: true,
  ...taskLinksInclude,
} as const;

export async function buildTaskIncludeForViewer(
  authContext: AuthenticationContext,
  tx?: Prisma.TransactionClient,
) {
  return {
    ...taskBaseInclude,
    share: true,
    ...(await buildVisibleTaskLinksInclude(authContext, tx)),
  } satisfies Prisma.TaskInclude;
}

export type TaskListItemWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskListInclude;
}>;

export type TaskWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;
