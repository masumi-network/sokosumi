import { type Prisma, workspaceRelationInclude } from "@sokosumi/database";
import {
  jobSummaryOwnerOrganizationInclude,
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
  orchestrator: {
    select: { id: true, name: true },
  },
  transaction: { select: { amount: true } },
} as const;

const taskOwnerAssigneeCreatorInclude = {
  owner: taskEventApiInclude.user,
  organization: { select: { id: true, name: true, slug: true } },
  assignee: taskEventApiInclude.coworker,
  creatorUser: taskEventApiInclude.user,
  creatorCoworker: taskEventApiInclude.coworker,
  creatorOrchestrator: taskEventApiInclude.orchestrator,
} as const;

const taskBaseInclude = {
  ...workspaceRelationInclude,
  ...taskOwnerAssigneeCreatorInclude,
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
      ...jobSummaryOwnerOrganizationInclude,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
} as const;

export const taskListInclude = {
  ...workspaceRelationInclude,
  ...taskOwnerAssigneeCreatorInclude,
  _count: {
    select: {
      events: {
        where: {
          comment: { not: null },
        },
      },
      jobs: true,
    },
  },
} as const;

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
