import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { badRequest } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
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
    const userContext = await requireAuthorizedUserContext(authContext);
    const queryParams = c.req.valid("query");
    const { scope, organizationId, projectId, taskId, assigneeId } =
      queryParams;
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    // Resolve workspace from scope
    let workspaceId: string;
    if (scope === "me") {
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      if (workspaceContext.organizationId) {
        throw badRequest(
          "Cannot use scope=me with organization workspace context",
        );
      }
      workspaceId = workspaceContext.workspaceId;
    } else {
      // scope === "org"
      if (!organizationId) {
        throw badRequest("organizationId is required when scope=org");
      }
      // Find org workspace
      const orgWorkspace = await prisma.workspace.findUnique({
        where: {
          organizationId,
        },
      });
      if (!orgWorkspace) {
        throw badRequest("Organization workspace not found");
      }
      // Check member access
      const member = await prisma.member.findUnique({
        where: {
          userId_organizationId: {
            userId: userContext.userId,
            organizationId,
          },
        },
      });
      if (!member) {
        throw badRequest("Not a member of this organization");
      }
      workspaceId = orgWorkspace.id;
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

      // Build where clause for tasks
      const tasksWhere = {
        workspaceId,
        archivedAt: null,
        ...projectFilter,
        ...(assigneeId ? { assigneeId } : {}),
        files: {
          some: {},
        },
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
    const projectsWhere = {
      workspaceId,
      archivedAt: null,
      tasks: {
        some: {
          archivedAt: null,
          ...(assigneeId ? { assigneeId } : {}),
          files: {
            some: {},
          },
        },
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
            where: {
              archivedAt: null,
              files: {
                some: {},
              },
            },
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
    const noProjectTasksCount = await prisma.task.count({
      where: {
        workspaceId,
        archivedAt: null,
        projectId: null,
        ...(assigneeId ? { assigneeId } : {}),
        files: {
          some: {},
        },
      },
    });

    if (noProjectTasksCount > 0) {
      const latestNoProjectFile = await prisma.taskFile.findFirst({
        where: {
          task: {
            workspaceId,
            archivedAt: null,
            projectId: null,
            ...(assigneeId ? { assigneeId } : {}),
          },
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
