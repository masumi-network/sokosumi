import { type Prisma, workspaceRelationInclude } from "@sokosumi/database";
import { jobListSummaryInclude } from "@sokosumi/database/types/job";

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
  sokoBot: {
    select: {
      id: true,
      name: true,
      avatarSeed: true,
      avatarImageUrl: true,
      userId: true,
      user: { select: { id: true, name: true, image: true } },
    },
  },

  transaction: { select: { amount: true } },
} as const;

const taskOwnerAssigneeCreatorInclude = {
  owner: taskEventApiInclude.user,
  organization: { select: { id: true, name: true, slug: true } },
  assignee: taskEventApiInclude.coworker,
  assigneeSokoBot: taskEventApiInclude.sokoBot,
  creatorUser: taskEventApiInclude.user,
  creatorCoworker: taskEventApiInclude.coworker,
  creatorSokoBot: taskEventApiInclude.sokoBot,
} as const;

export const taskFileApiInclude = {
  uploadedByUser: { select: { id: true, name: true, image: true } },
  uploadedByCoworker: {
    select: { id: true, name: true, image: true, slug: true },
  },
  uploadedBySokoBot: taskEventApiInclude.sokoBot,
} as const;

const taskFilesInclude = {
  files: {
    include: taskFileApiInclude,
    orderBy: {
      createdAt: "desc" as const,
    },
  },
} as const;

const taskBaseInclude = {
  ...workspaceRelationInclude,
  ...taskOwnerAssigneeCreatorInclude,
  ...taskFilesInclude,
  events: {
    include: taskEventApiInclude,
    orderBy: {
      createdAt: "asc",
    },
  },
  jobs: {
    include: jobListSummaryInclude,
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
