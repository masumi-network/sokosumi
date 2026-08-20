import { createRoute, z } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";

import {
  requireCoworkerCapability,
  requireTaskReadForRouteVars,
} from "@/helpers/access-control";
import { badRequest, forbidden } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import {
  buildCoworkerTaskListAccessFilter,
  hasGrantedWorkspaceAccess,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { isCoworkerAuthContext, requireUserContext } from "@/middleware/auth";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  type DriveTasksListItem,
  driveTasksListSchema,
} from "@/schemas/drive-tasks.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

const query = z
  .object({
    scope: driveFileScopeSchema.openapi({
      description:
        "Drive scope: 'me' for personal workspace, 'org' for organization workspace",
    }),
    organizationId: z
      .string()
      .optional()
      .openapi({
        param: { name: "organizationId", in: "query" },
        description: "Organization ID (required when scope=org)",
        example: "org_123",
      }),
    projectId: z
      .union([z.string().uuid(), z.literal("null")])
      .optional()
      .openapi({
        param: { name: "projectId", in: "query" },
        description:
          'Project ID to list tasks within. Use literal "null" for no-project tasks. Omit for project-level list.',
        example: "prj_abc123",
      }),
    taskId: z
      .string()
      .optional()
      .openapi({
        param: { name: "taskId", in: "query" },
        description:
          "Task ID to list files within. Omit for task-level or project-level list.",
        example: "tsk_xyz789",
      }),
    assigneeId: z
      .string()
      .optional()
      .openapi({
        param: { name: "assigneeId", in: "query" },
        description: "Filter tasks by assignee coworker ID",
        example: "cow_123",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape)
  .refine(
    (data) => {
      if (data.scope === "org" && !data.organizationId) {
        return false;
      }
      return true;
    },
    {
      message: "organizationId is required when scope=org",
      path: ["organizationId"],
    },
  );

const route = createRoute({
  method: "get",
  path: "/",
  description: [
    "List Drive Tasks (virtual folder over TaskFile). One level at a time:",
    "- No projectId, no taskId → project rows (+ no-project row when unscoped tasks have files)",
    "- projectId set, no taskId → task rows with files",
    "- taskId set → TaskFile rows",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    query,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      driveTasksListSchema,
      "Drive Tasks list retrieved",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const queryParams = c.req.valid("query");
    const { scope, organizationId, projectId, taskId, assigneeId } =
      queryParams;
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    // Resolve workspace from Drive scope (must match Tasks list ACL)
    let workspaceId: string;
    let userId: string | null = null;

    if (isCoworkerAuthContext(authContext)) {
      await requireCoworkerCapability(authContext.coworkerId, "tasks");

      // Coworker with context: resolve workspace like Tasks list
      if (authContext.context) {
        userId = authContext.context.userId;
        const orgId = authContext.context.organizationId ?? null;

        // Resolve workspace via workspaceRepository (same as Tasks list)
        const workspace = await workspaceRepository.resolveWorkspaceForContext(
          userId,
          orgId,
          prisma,
        );
        workspaceId = workspace.id;

        // Map Drive scope to workspace ownership
        if (scope === "me") {
          if (orgId) {
            throw badRequest(
              "Cannot use scope=me when context has organizationId",
            );
          }
        } else {
          // scope === "org"
          if (!organizationId) {
            throw badRequest("organizationId is required when scope=org");
          }
          if (organizationId !== orgId) {
            throw forbidden("Cannot access different organization's Drive");
          }
        }
      } else {
        // Bare coworker (no context): vendor-wide like Tasks list
        // Drive Tasks is typically user-session only, but implement for ACL parity
        throw forbidden("Drive Tasks requires workspace context");
      }
    } else {
      // User path
      const userContext = requireUserContext(authContext);
      userId = userContext.userId;

      if (scope === "me") {
        // Personal workspace
        const workspace = await workspaceRepository.resolveWorkspaceForContext(
          userId,
          null,
          prisma,
        );
        workspaceId = workspace.id;
      } else {
        // scope === "org"
        if (!organizationId) {
          throw badRequest("organizationId is required when scope=org");
        }

        // Check membership
        const member = await prisma.member.findUnique({
          where: {
            userId_organizationId: {
              userId,
              organizationId,
            },
          },
        });
        if (!member) {
          throw forbidden("Not a member of this organization");
        }

        // Resolve org workspace
        const workspace = await workspaceRepository.resolveWorkspaceForContext(
          userId,
          organizationId,
          prisma,
        );
        workspaceId = workspace.id;
      }
    }

    // Build base where clause (workspace-wide, like Tasks scope=workspace)
    const baseTaskWhere: Prisma.TaskWhereInput = {
      archivedAt: null,
      workspaceId,
      ...(assigneeId ? { assigneeId } : {}),
      files: {
        some: {},
      },
    };

    // Apply coworker access filter if needed
    if (isCoworkerAuthContext(authContext) && authContext.context) {
      const hasWorkspaceGrant = await hasGrantedWorkspaceAccess({
        vendorId: authContext.vendorId,
        workspaceId,
      });

      const listAccessFilter = buildCoworkerTaskListAccessFilter({
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        hasWorkspaceGrant,
      });

      baseTaskWhere.AND = [listAccessFilter];
    }

    // Determine level
    if (taskId) {
      // Level 3: TaskFile rows
      await requireTaskReadForRouteVars(c.var, taskId);

      const takePlusOne = take + 1;
      const [taskFiles, count] = await Promise.all([
        prisma.taskFile.findMany({
          where: {
            task: {
              id: taskId,
              workspaceId,
              archivedAt: null,
            },
          },
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        }),
        prisma.taskFile.count({
          where: {
            task: {
              id: taskId,
              workspaceId,
              archivedAt: null,
            },
          },
        }),
      ]);

      const hasMore = taskFiles.length === takePlusOne;
      const pagedFiles = taskFiles.slice(0, take);
      const items: DriveTasksListItem[] = pagedFiles.map((file) => ({
        type: "task-file",
        id: file.id,
        name: file.name,
        fileUrl: file.fileUrl,
        size: file.size ? Number(file.size) : null,
        mimeType: file.mimeType,
        updatedAt: file.updatedAt.toISOString(),
      }));

      const paginationMeta = createPaginationMeta(
        pagedFiles,
        count,
        take,
        hasMore,
        cursor,
      );
      return ok(c, driveTasksListSchema.parse(items), paginationMeta);
    }

    if (projectId !== undefined) {
      // Level 2: Task rows with files
      const projectFilter =
        projectId === "null" ? { projectId: null } : { projectId };

      const takePlusOne = take + 1;
      const tasksWhere = {
        ...baseTaskWhere,
        ...projectFilter,
      };

      const [tasks, count] = await Promise.all([
        prisma.task.findMany({
          where: tasksWhere,
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          include: {
            files: {
              orderBy: { updatedAt: "desc" },
              take: 1,
            },
          },
        }),
        prisma.task.count({ where: tasksWhere }),
      ]);

      const hasMore = tasks.length === takePlusOne;
      const pagedTasks = tasks.slice(0, take);
      const items: DriveTasksListItem[] = pagedTasks.map((task) => ({
        type: "task",
        id: task.id,
        name: task.name,
        latestFileUpdatedAt:
          task.files[0]?.updatedAt.toISOString() ?? new Date().toISOString(),
      }));

      const paginationMeta = createPaginationMeta(
        pagedTasks,
        count,
        take,
        hasMore,
        cursor,
      );
      return ok(c, driveTasksListSchema.parse(items), paginationMeta);
    }

    // Level 1: Project rows + no-project row
    const takePlusOne = take + 1;

    // Projects with at least one task with files
    const projectsWhere: Prisma.ProjectWhereInput = {
      workspaceId,
      tasks: {
        some: baseTaskWhere,
      },
    };

    const [projects, projectsCount] = await Promise.all([
      prisma.project.findMany({
        where: projectsWhere,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: {
          tasks: {
            where: baseTaskWhere,
            include: {
              files: {
                orderBy: { updatedAt: "desc" },
                take: 1,
              },
            },
            orderBy: [{ updatedAt: "desc" }],
            take: 1,
          },
        },
      }),
      prisma.project.count({ where: projectsWhere }),
    ]);

    const hasMore = projects.length === takePlusOne;
    const pagedProjects = projects.slice(0, take);
    const items: DriveTasksListItem[] = pagedProjects.map((project) => ({
      type: "project",
      id: project.id,
      name: project.name,
      latestFileUpdatedAt:
        project.tasks[0]?.files[0]?.updatedAt.toISOString() ??
        new Date().toISOString(),
    }));

    // Check for no-project tasks with files
    const noProjectWhere = {
      ...baseTaskWhere,
      projectId: null,
    };

    const noProjectTasksCount = await prisma.task.count({
      where: noProjectWhere,
    });

    if (noProjectTasksCount > 0) {
      const latestNoProjectFile = await prisma.taskFile.findFirst({
        where: {
          task: noProjectWhere,
        },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      });

      items.push({
        type: "no-project",
        id: "null",
        latestFileUpdatedAt:
          latestNoProjectFile?.updatedAt.toISOString() ??
          new Date().toISOString(),
      });
    }

    const totalCount = projectsCount + (noProjectTasksCount > 0 ? 1 : 0);
    const paginationMeta = createPaginationMeta(
      pagedProjects,
      totalCount,
      take,
      hasMore,
      cursor,
    );
    return ok(c, driveTasksListSchema.parse(items), paginationMeta);
  });
}
