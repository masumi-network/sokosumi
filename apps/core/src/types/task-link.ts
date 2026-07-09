import { type Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import { type AuthenticationContext } from "@/middleware/auth";

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
  switch (authContext.actor) {
    case "coworker": {
      if (authContext.delegation) {
        if (workspaceId) {
          return {
            workspaceId,
            archivedAt: null,
            pendingVendorGrantId: null,
          };
        }

        return {
          userId: authContext.delegation.userId,
          pendingVendorGrantId: null,
        };
      }

      return {
        coworkerId: authContext.coworkerId,
        archivedAt: null,
        pendingVendorGrantId: null,
        NOT: {
          status: {
            in: [TaskStatus.DRAFT],
          },
        },
      };
    }
    case "user": {
      if (workspaceId) {
        return {
          workspaceId,
          archivedAt: null,
          pendingVendorGrantId: null,
        };
      }

      return {
        userId: authContext.userId,
        pendingVendorGrantId: null,
      };
    }
    default: {
      const exhaustive: never = authContext;
      return exhaustive;
    }
  }
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
