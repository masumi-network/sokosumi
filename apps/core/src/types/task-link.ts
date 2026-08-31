import { type Prisma } from "@sokosumi/database";

import { buildCoworkerSiblingTaskListFilter } from "@/helpers/vendor-siblings";
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
      if (authContext.context) {
        const base: Prisma.TaskWhereInput = workspaceId
          ? { workspaceId, archivedAt: null }
          : {
              ownerId: authContext.context.userId,
              archivedAt: null,
            };

        return {
          ...base,
          ...buildCoworkerSiblingTaskListFilter({
            coworkerId: authContext.coworkerId,
            vendorId: authContext.vendorId,
          }),
        };
      }

      // Match bare coworker task read: assignee or same-vendor sibling, non-DRAFT.
      return {
        archivedAt: null,
        ...buildCoworkerSiblingTaskListFilter({
          coworkerId: authContext.coworkerId,
          vendorId: authContext.vendorId,
        }),
      };
    }
    case "user": {
      if (workspaceId) {
        return {
          workspaceId,
          archivedAt: null,
        };
      }

      return {
        ownerId: authContext.userId,
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
