import {
  type Prisma,
  workCreatorInclude,
  workspaceRelationInclude,
} from "@sokosumi/database";
import { jobListSummaryInclude } from "@sokosumi/database/types/job";

import type { AuthenticationContext } from "@/middleware/auth";
import {
  buildVisibleTaskLinksInclude,
  taskLinksInclude,
} from "@/types/task-link";

const userSummarySelect = {
  select: { id: true, name: true, image: true },
} as const;

const sokoBotSummarySelect = {
  id: true,
  name: true,
  avatarSeed: true,
  avatarImageUrl: true,
  userId: true,
} as const;

export const taskEventApiInclude = {
  user: userSummarySelect,
  coworker: {
    select: { id: true, name: true, image: true, slug: true, vendorId: true },
  },
  sokoBot: {
    select: {
      ...sokoBotSummarySelect,
      user: userSummarySelect,
    },
  },

  transaction: { select: { amount: true } },
} as const;

/**
 * Event list read without the nested user selects. Callers load every user id
 * in one findMany; Prisma otherwise issues the same user summary select once
 * per relation.
 */
export const taskEventListInclude = {
  coworker: taskEventApiInclude.coworker,
  sokoBot: { select: sokoBotSummarySelect },
  transaction: taskEventApiInclude.transaction,
} as const;

const taskParticipantsInclude = {
  participants: {
    // UUID v7 ids sort in join order.
    orderBy: {
      id: "asc" as const,
    },
    include: {
      user: taskEventApiInclude.user,
    },
  },
} as const;

const taskOwnerAssigneeCreatorInclude = {
  owner: taskEventApiInclude.user,
  organization: { select: { id: true, name: true, slug: true } },
  project: {
    select: { id: true, name: true, identifier: true, logo: true },
  },
  assignee: taskEventApiInclude.coworker,
  assigneeSokoBot: taskEventApiInclude.sokoBot,
  assigneeUser: taskEventApiInclude.user,
  ...workCreatorInclude,
  ...taskParticipantsInclude,
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

const taskListCountAndStatus = {
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
  // The latest status change, for how long the Task has been in its status.
  events: {
    where: { status: { not: null } },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { createdAt: true },
  },
} as const;

export const taskListInclude = {
  ...workspaceRelationInclude,
  ...taskOwnerAssigneeCreatorInclude,
  ...taskListCountAndStatus,
} as const;

/**
 * Task list read without user relations. The list route batches those ids into
 * one user findMany. Leaving them on the include makes Prisma repeat the same
 * user summary select for owner, assignee, participant, creator and each bot.
 */
export const taskListReadInclude = {
  ...workspaceRelationInclude,
  creatorCoworker: workCreatorInclude.creatorCoworker,
  creatorSokoBot: { select: sokoBotSummarySelect },
  organization: { select: { id: true, name: true, slug: true } },
  project: {
    select: { id: true, name: true, identifier: true, logo: true },
  },
  assignee: taskEventApiInclude.coworker,
  assigneeSokoBot: { select: sokoBotSummarySelect },
  participants: {
    orderBy: {
      id: "asc" as const,
    },
  },
  ...taskListCountAndStatus,
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
