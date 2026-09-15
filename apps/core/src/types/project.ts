import type { Prisma } from "@sokosumi/database";
import { forbidden } from "@/helpers/error";
import {
  buildCoworkerJobParentTaskWhere,
  buildHumanJobParentVisibilityWhere,
  buildHumanTaskVisibilityWhere,
} from "@/helpers/task-visibility";
import {
  buildCoworkerTaskListAccessFilter,
  hasGrantedWorkspaceAccess,
} from "@/helpers/vendor-grants";
import type { AuthenticationContext } from "@/middleware/auth";

export interface ProjectReaderVisibility {
  taskWhere: Prisma.TaskWhereInput;
  jobWhere: Prisma.JobWhereInput;
}

export function humanProjectReaderVisibility(
  readerUserId: string,
): ProjectReaderVisibility {
  return {
    taskWhere: buildHumanTaskVisibilityWhere(readerUserId),
    jobWhere: buildHumanJobParentVisibilityWhere(readerUserId),
  };
}

export async function resolveProjectReaderVisibility(
  authContext: AuthenticationContext,
  workspaceId: string,
): Promise<ProjectReaderVisibility> {
  if (authContext.actor === "user" || authContext.actor === "sokoBot") {
    return humanProjectReaderVisibility(authContext.userId);
  }

  if (authContext.actor === "coworker") {
    const hasWorkspaceGrant = authContext.context
      ? await hasGrantedWorkspaceAccess({
          vendorId: authContext.vendorId,
          workspaceId,
        })
      : false;

    return {
      taskWhere: buildCoworkerTaskListAccessFilter({
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        hasWorkspaceGrant,
      }),
      jobWhere: buildCoworkerJobParentTaskWhere({
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
      }),
    };
  }

  throw forbidden("Unsupported actor for project visibility");
}

export function createProjectListCountsInclude(
  workspaceId: string,
  visibility: ProjectReaderVisibility,
) {
  return {
    _count: {
      select: {
        tasks: {
          where: {
            archivedAt: null,
            workspaceId,
            ...visibility.taskWhere,
          },
        },
        jobs: {
          where: {
            workspaceId,
            ...visibility.jobWhere,
          },
        },
      },
    },
  } satisfies Prisma.ProjectInclude;
}
