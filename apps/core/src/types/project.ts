import type { Prisma } from "@sokosumi/database";

import {
  buildHumanJobParentVisibilityWhere,
  buildHumanTaskVisibilityWhere,
} from "@/helpers/task-visibility";

export function createProjectListCountsInclude(
  workspaceId: string,
  readerUserId: string,
) {
  return {
    _count: {
      select: {
        tasks: {
          where: {
            archivedAt: null,
            workspaceId,
            ...buildHumanTaskVisibilityWhere(readerUserId),
          },
        },
        jobs: {
          where: {
            workspaceId,
            ...buildHumanJobParentVisibilityWhere(readerUserId),
          },
        },
      },
    },
  } satisfies Prisma.ProjectInclude;
}
