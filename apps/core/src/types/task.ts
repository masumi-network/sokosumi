import { type Prisma, TaskStatus } from "@sokosumi/database";
import {
  jobWithEvents,
  jobWithPurchase,
  jobWithTransaction,
} from "@sokosumi/database/types/job";

import { buildTaskScopeFilters, type TaskScope } from "@/helpers/scope";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
} from "@/middleware/auth";

const taskBaseInclude = {
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
} as const;

export const taskLinkPeerTaskSelect = {
  id: true,
  name: true,
  status: true,
  archivedAt: true,
} as const;

export type TaskLinkPeerTask = Prisma.TaskGetPayload<{
  select: typeof taskLinkPeerTaskSelect;
}>;

export const taskLinkWithPeerTasksInclude = {
  fromTask: {
    select: taskLinkPeerTaskSelect,
  },
  toTask: {
    select: taskLinkPeerTaskSelect,
  },
} as const;

export type TaskLinkWithPeerTasks = Prisma.TaskLinkGetPayload<{
  include: typeof taskLinkWithPeerTasksInclude;
}>;

export const taskInclude = {
  ...taskBaseInclude,
  linksFrom: {
    include: taskLinkWithPeerTasksInclude,
    orderBy: {
      createdAt: "asc",
    },
  },
  linksTo: {
    include: taskLinkWithPeerTasksInclude,
    orderBy: {
      createdAt: "asc",
    },
  },
} as const;

function buildVisiblePeerTaskWhere(
  authContext: AuthenticationContext,
  scopes?: TaskScope[],
): Prisma.TaskWhereInput {
  if (isCoworkerAuthContext(authContext)) {
    return {
      coworkerId: authContext.coworkerId,
      archivedAt: null,
      NOT: {
        status: {
          in: [TaskStatus.DRAFT],
        },
      },
    };
  }

  return {
    OR: buildTaskScopeFilters(authContext, scopes),
  };
}

export function buildVisibleTaskLinksInclude(
  authContext: AuthenticationContext,
  scopes?: TaskScope[],
) {
  const peerTaskWhere = buildVisiblePeerTaskWhere(authContext, scopes);

  return {
    linksFrom: {
      where: {
        toTask: {
          is: peerTaskWhere,
        },
      },
      include: taskLinkWithPeerTasksInclude,
      orderBy: {
        createdAt: "asc",
      },
    },
    linksTo: {
      where: {
        fromTask: {
          is: peerTaskWhere,
        },
      },
      include: taskLinkWithPeerTasksInclude,
      orderBy: {
        createdAt: "asc",
      },
    },
  } satisfies Pick<Prisma.TaskInclude, "linksFrom" | "linksTo">;
}

export function buildTaskIncludeForViewer(
  authContext: AuthenticationContext,
  scopes?: TaskScope[],
) {
  return {
    ...taskBaseInclude,
    ...buildVisibleTaskLinksInclude(authContext, scopes),
  } satisfies Prisma.TaskInclude;
}

export type TaskWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;
