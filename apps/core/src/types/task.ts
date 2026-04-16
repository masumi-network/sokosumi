import { type Prisma, workspaceRelationInclude } from "@sokosumi/database";
import {
  jobWithEvents,
  jobWithPurchase,
  jobWithTransaction,
} from "@sokosumi/database/types/job";

import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import {
  buildVisibleTaskLinksInclude,
  taskLinksInclude,
} from "@/types/task-link";

const taskBaseInclude = {
  ...workspaceRelationInclude,
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

export function buildTaskIncludeForViewer(
  authContext: AuthenticationContext,
  workspaceContext?: WorkspaceContext | null,
) {
  return {
    ...taskBaseInclude,
    share: true,
    ...buildVisibleTaskLinksInclude(authContext, workspaceContext),
  } satisfies Prisma.TaskInclude;
}

export type TaskListItemWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskListInclude;
}>;

export type TaskWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;
