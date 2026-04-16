import { type Prisma, TaskStatus } from "@sokosumi/database";

import {
  type AuthenticationContext,
  isCoworkerAuthContext,
} from "@/middleware/auth";

export const taskLinkPeerTaskSelect = {
  id: true,
  name: true,
  status: true,
  archivedAt: true,
} as const;

const taskLinkPeerTaskInclude = {
  fromTask: {
    select: taskLinkPeerTaskSelect,
  },
  toTask: {
    select: taskLinkPeerTaskSelect,
  },
} as const;

export const taskLinksInclude = {
  linksFrom: {
    include: taskLinkPeerTaskInclude,
    orderBy: {
      createdAt: "asc",
    },
  },
  linksTo: {
    include: taskLinkPeerTaskInclude,
    orderBy: {
      createdAt: "asc",
    },
  },
} as const;

function buildVisiblePeerTaskWhere(
  authContext: AuthenticationContext,
  workspaceId?: string | null,
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

  if (workspaceId) {
    return {
      workspaceId,
      archivedAt: null,
    };
  }

  return {
    userId: authContext.userId,
  };
}

export function buildVisibleTaskLinksInclude(
  authContext: AuthenticationContext,
  workspaceId?: string | null,
) {
  const peerTaskWhere = buildVisiblePeerTaskWhere(authContext, workspaceId);

  return {
    linksFrom: {
      where: {
        toTask: {
          is: peerTaskWhere,
        },
      },
      include: taskLinkPeerTaskInclude,
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
      include: taskLinkPeerTaskInclude,
      orderBy: {
        createdAt: "asc",
      },
    },
  } satisfies Pick<Prisma.TaskInclude, "linksFrom" | "linksTo">;
}

export type TaskLinkPeerTaskRow = Prisma.TaskGetPayload<{
  select: typeof taskLinkPeerTaskSelect;
}>;

export type TaskLinkRow = Prisma.TaskLinkGetPayload<Record<string, never>> & {
  fromTask?: TaskLinkPeerTaskRow | null;
  toTask?: TaskLinkPeerTaskRow | null;
};
