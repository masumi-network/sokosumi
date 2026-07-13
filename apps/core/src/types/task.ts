import { type Prisma, workspaceRelationInclude } from "@sokosumi/database";
import {
  jobSummaryUserOrganizationInclude,
  jobWithEvents,
  jobWithPurchase,
  jobWithTransaction,
} from "@sokosumi/database/types/job";

import type { AuthenticationContext } from "@/middleware/auth";
import {
  buildVisibleTaskLinksInclude,
  taskLinksInclude,
} from "@/types/task-link";

export const taskEventApiInclude = {
  user: { select: { id: true, name: true, image: true } },
  coworker: {
    select: { id: true, name: true, image: true, slug: true, vendorId: true },
  },
  transaction: { select: { amount: true } },
} as const;

const taskUserOrganizationInclude = {
  user: taskEventApiInclude.user,
  organization: { select: { id: true, name: true, slug: true } },
  coworker: taskEventApiInclude.coworker,
} as const;

const taskBaseInclude = {
  ...workspaceRelationInclude,
  ...taskUserOrganizationInclude,
  events: {
    include: taskEventApiInclude,
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
      ...jobSummaryUserOrganizationInclude,
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
  workspaceId?: string | null,
) {
  return {
    ...taskBaseInclude,
    share: true,
    ...buildVisibleTaskLinksInclude(authContext, workspaceId),
  };
}

export type TaskListItemWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskListInclude;
}>;

export type TaskWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;

type TaskDetailInclude = ReturnType<typeof buildTaskIncludeForViewer>;

export type TaskDetailPayload = Prisma.TaskGetPayload<{
  include: TaskDetailInclude;
}>;
