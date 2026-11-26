import {
  type Prisma,
  type WorkspaceLabel,
  workCreatorInclude,
  workspaceRelationInclude,
} from "@sokosumi/database";
import { jobListSummaryInclude } from "@sokosumi/database/types/job";

import { taskFollowersInclude } from "@/helpers/task-follower-rows";
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
      versionId: true,
      userId: true,
      user: { select: { id: true, name: true, image: true } },
    },
  },

  transaction: { select: { amount: true } },
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

const workspaceTagLabel = {
  select: { id: true, displayName: true, color: true, customColor: true },
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
  workspaceTags: {
    select: {
      state: true,
      label: {
        select: {
          ...workspaceTagLabel.select,
          kind: true,
          archivedAt: true,
          createdByUserId: true,
          description: true,
        },
      },
    },
    orderBy: { label: { normalizedName: "asc" } },
  },
} as const;

/** Applied tags belong to the Task. A pending offer can reveal an unapplied workspace label. */
export function taskTagSuggestionsForViewer(
  authContext: AuthenticationContext,
  activeWorkspaceId?: string | null,
) {
  const userId =
    authContext.actor === "coworker"
      ? authContext.context?.userId
      : authContext.userId;
  const bound =
    activeWorkspaceId &&
    userId &&
    (authContext.actor !== "sokoBot" ||
      authContext.workspaceId === activeWorkspaceId);
  const where: Prisma.TaskWorkspaceTagDecisionWhereInput = bound
    ? {
        state: "JEV_SUGGESTED",
        label: {
          workspaceId: activeWorkspaceId,
          archivedAt: null,
          mergedIntoId: null,
          workspace: {
            OR: [
              { userId },
              { organization: { members: { some: { userId } } } },
            ],
            ...(authContext.actor === "coworker" && {
              vendorGrants: {
                some: { vendorId: authContext.vendorId, status: "GRANTED" },
              },
            }),
          },
        },
      }
    : { labelId: { in: [] } };
  return {
    workspaceTagDecisions: {
      where,
      select: { label: workspaceTagLabel },
      orderBy: { label: { normalizedName: "asc" } },
    },
  } as const satisfies Prisma.TaskInclude;
}

type WorkspaceTagSuggestions = {
  workspaceTagDecisions?: {
    label: Pick<WorkspaceLabel, "id" | "displayName" | "color" | "customColor">;
  }[];
};

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

// Direct sub-tasks that count toward `subtaskProgress`.
const taskSubtaskProgressInclude = {
  subtasks: {
    where: { archivedAt: null },
    select: { status: true },
  },
} as const;

const taskBaseInclude = {
  ...workspaceRelationInclude,
  ...taskSubtaskProgressInclude,
  ...taskOwnerAssigneeCreatorInclude,
  ...taskFilesInclude,
  ...taskFollowersInclude,
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
  // The list also names the first open sub-tasks, so it reads a few more
  // columns of the same rows the progress counts.
  subtasks: {
    where: { archivedAt: null },
    orderBy: [
      { position: "asc" },
      { id: "asc" },
    ] as Prisma.TaskOrderByWithRelationInput[],
    select: { id: true, number: true, name: true, status: true },
  },
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
  // The latest status change, for how long the Task has been in its status.
  events: {
    where: { status: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { createdAt: true },
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
  activeWorkspaceId?: string | null,
) {
  return {
    ...taskBaseInclude,
    ...taskTagSuggestionsForViewer(authContext, activeWorkspaceId),
    share: true,
    ...buildVisibleTaskLinksInclude(authContext, workspaceId),
  };
}

export type TaskListItemWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskListInclude;
}> &
  WorkspaceTagSuggestions;

export type TaskWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}> &
  WorkspaceTagSuggestions;

type TaskDetailInclude = ReturnType<typeof buildTaskIncludeForViewer>;

export type TaskDetailPayload = Prisma.TaskGetPayload<{
  include: TaskDetailInclude;
}>;
