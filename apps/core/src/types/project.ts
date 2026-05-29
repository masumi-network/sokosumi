import type { Prisma } from "@sokosumi/database";

export function createProjectListCountsInclude(workspaceId: string) {
  return {
    _count: {
      select: {
        tasks: {
          where: {
            archivedAt: null,
            workspaceId,
          },
        },
        jobs: {
          where: {
            workspaceId,
          },
        },
      },
    },
  } satisfies Prisma.ProjectInclude;
}
