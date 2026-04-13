import { type Prisma, TaskStatus } from "@sokosumi/database";

import {
  type AuthenticationContext,
  isCoworkerAuthContext,
} from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

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

export function buildVisiblePeerTaskWhere(
  authContext: AuthenticationContext,
  workspaceContext: WorkspaceContext | null,
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

  const workspaceId = workspaceContext?.workspaceId ?? "__missing_workspace__";
  const workspaceOrganizationId = workspaceContext?.organizationId ?? null;
  const isOrganizationWorkspace =
    workspaceOrganizationId !== null &&
    workspaceOrganizationId === authContext.organizationId;

  return {
    workspaceId,
    ...(isOrganizationWorkspace ? {} : { userId: authContext.userId }),
  };
}

export function buildVisibleTaskLinksInclude(
  authContext: AuthenticationContext,
  workspaceContext: WorkspaceContext | null,
) {
  const peerTaskWhere = buildVisiblePeerTaskWhere(
    authContext,
    workspaceContext,
  );

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
