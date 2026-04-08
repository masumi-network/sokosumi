import { type Prisma, TaskStatus } from "@sokosumi/database";
import {
  buildWorkspaceWhere,
  resolveWorkspaceContext,
} from "@/helpers/access-control";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  type WorkspaceContext,
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

async function buildVisiblePeerTaskWhere(
  authContext: AuthenticationContext | WorkspaceContext,
  tx?: Prisma.TransactionClient,
): Promise<Prisma.TaskWhereInput> {
  if ("actor" in authContext && isCoworkerAuthContext(authContext)) {
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

  if ("workspaceId" in authContext) {
    return buildWorkspaceWhere(authContext);
  }

  const workspaceContext = await resolveWorkspaceContext(authContext, tx);
  if (!workspaceContext) {
    return {
      workspaceId: "__missing_workspace__",
    };
  }

  return buildWorkspaceWhere(workspaceContext);
}

export async function buildVisibleTaskLinksInclude(
  authContext: AuthenticationContext | WorkspaceContext,
  tx?: Prisma.TransactionClient,
) {
  const peerTaskWhere = await buildVisiblePeerTaskWhere(authContext, tx);

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
