import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { forbidden } from "@/helpers/error";
import {
  buildCoworkerJobParentTaskWhere,
  buildCoworkerTaskAccessSql,
  buildHumanJobParentVisibilityWhere,
  buildHumanTaskVisibilitySql,
  buildHumanTaskVisibilityWhere,
} from "@/helpers/task-visibility";
import {
  buildCoworkerTaskListAccessFilter,
  hasGrantedWorkspaceAccess,
} from "@/helpers/vendor-grants";
import type {
  AuthenticationContext,
  CoworkerAuthenticationContext,
} from "@/middleware/auth";

export interface ProjectReaderVisibility {
  taskWhere: Prisma.TaskWhereInput;
  jobWhere: Prisma.JobWhereInput;
}

export interface ProjectReaderSqlVisibility {
  task: PrismaRaw.Sql;
  job: PrismaRaw.Sql;
}

export interface ProjectReaderAccess {
  prismaWhere: ProjectReaderVisibility;
  sqlWhere: ProjectReaderSqlVisibility;
}

export function humanProjectReaderVisibility(
  readerUserId: string,
): ProjectReaderVisibility {
  return {
    taskWhere: buildHumanTaskVisibilityWhere(readerUserId),
    jobWhere: buildHumanJobParentVisibilityWhere(readerUserId),
  };
}

function humanProjectReaderSqlVisibility(
  readerUserId: string,
): ProjectReaderSqlVisibility {
  const task = buildHumanTaskVisibilitySql(readerUserId);
  return {
    task,
    job: PrismaRaw.sql`AND (j."taskId" IS NULL OR (TRUE ${task}))`,
  };
}

function coworkerProjectReaderVisibility(
  authContext: CoworkerAuthenticationContext,
  hasWorkspaceGrant: boolean,
): ProjectReaderVisibility {
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

function coworkerProjectReaderSqlVisibility(
  authContext: CoworkerAuthenticationContext,
  hasWorkspaceGrant: boolean,
): ProjectReaderSqlVisibility {
  return {
    task: buildCoworkerTaskAccessSql({ ...authContext, hasWorkspaceGrant }),
    // Same parent-task rule as buildCoworkerJobParentTaskWhere. A workspace
    // grant does not broaden the Job reader set.
    job: PrismaRaw.sql`AND (
      t."assigneeId" = ${authContext.coworkerId}
      OR (t.visibility = 'PRIVATE' AND EXISTS (
        SELECT 1 FROM coworker c
        WHERE c.id = t."assigneeId" AND c."vendorId" = ${authContext.vendorId}::uuid
      ))
    )`,
  };
}

export async function resolveProjectReaderAccess(
  authContext: AuthenticationContext,
  workspaceId: string,
): Promise<ProjectReaderAccess> {
  if (authContext.actor === "user" || authContext.actor === "sokoBot") {
    return {
      prismaWhere: humanProjectReaderVisibility(authContext.userId),
      sqlWhere: humanProjectReaderSqlVisibility(authContext.userId),
    };
  }

  if (authContext.actor === "coworker") {
    const hasWorkspaceGrant = authContext.context
      ? await hasGrantedWorkspaceAccess({
          vendorId: authContext.vendorId,
          workspaceId,
        })
      : false;

    return {
      prismaWhere: coworkerProjectReaderVisibility(
        authContext,
        hasWorkspaceGrant,
      ),
      sqlWhere: coworkerProjectReaderSqlVisibility(
        authContext,
        hasWorkspaceGrant,
      ),
    };
  }

  throw forbidden("Unsupported actor for project visibility");
}

export async function resolveProjectReaderVisibility(
  authContext: AuthenticationContext,
  workspaceId: string,
): Promise<ProjectReaderVisibility> {
  const { prismaWhere } = await resolveProjectReaderAccess(
    authContext,
    workspaceId,
  );
  return prismaWhere;
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
