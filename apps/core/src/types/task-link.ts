import { type Prisma, TaskStatus } from "@sokosumi/database";

import { buildTaskScopeFilters, type TaskScope } from "@/helpers/scope";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
} from "@/middleware/auth";

export const taskLinksInclude = {
  linksFrom: {
    orderBy: {
      createdAt: "asc",
    },
  },
  linksTo: {
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
      orderBy: {
        createdAt: "asc",
      },
    },
  } satisfies Pick<Prisma.TaskInclude, "linksFrom" | "linksTo">;
}

export type TaskLinkRow = Prisma.TaskLinkGetPayload<Record<string, never>>;
