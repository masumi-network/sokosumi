import { createRoute, z } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";

import {
  requireCoworkerCapability,
  requireTaskReadForRouteVars,
} from "@/helpers/access-control";
import { badRequest, forbidden, notFound } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
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

async function requireUserTaskReadByWorkspaceMembership(
  userId: string,
  taskId: string,
) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      archivedAt: null,
    },
    include: {
      workspace: {
        select: {
          userId: true,
          organizationId: true,
        },
      },
    },
  });

  if (!task) {
    throw notFound("Task not found");
  }

  const organizationId = task.workspace.organizationId;
  if (organizationId) {
    await resolveMemberOrganizationById({
      id: organizationId,
      userId,
      tx: prisma,
    });
    return;
  }

  if (task.workspace.userId !== userId) {
    throw notFound("Task not found");
  }
}

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
    404: jsonErrorResponse("Not Found"),
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
    // Include only tasks with READY TaskFiles (non-null fileUrl)
    const baseTaskWhere: Prisma.TaskWhereInput = {
      archivedAt: null,
      workspaceId,
      ...(assigneeId ? { assigneeId } : {}),
      files: {
        some: {
          status: "READY",
          fileUrl: { not: null },
        },
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
      if (isCoworkerAuthContext(authContext)) {
        await requireTaskReadForRouteVars(c.var, taskId);
      } else {
        const userContext = requireUserContext(authContext);
        await requireUserTaskReadByWorkspaceMembership(
          userContext.userId,
          taskId,
        );
      }

      // After access check, query TaskFiles directly (same filter as Level 2's files.some)
      const [taskFiles, taskFileCount] = await Promise.all([
        prisma.taskFile.findMany({
          where: {
            taskId,
            status: "READY",
            fileUrl: { not: null },
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        }),
        prisma.taskFile.count({
          where: {
            taskId,
            status: "READY",
            fileUrl: { not: null },
          },
        }),
      ]);

      // Apply cursor pagination
      let startIndex = 0;
      if (cursor) {
        const cursorIndex = taskFiles.findIndex((f) => f.id === cursor);
        if (cursorIndex >= 0) {
          startIndex = cursorIndex + 1; // Skip cursor item
        }
      }
      startIndex += skip ?? 0;

      const pagedFiles = taskFiles.slice(startIndex, startIndex + take);
      const hasMore = startIndex + take < taskFiles.length;

      const items: DriveTasksListItem[] = pagedFiles
        .map((file) => {
          // fileUrl is non-null (filtered in query)
          if (!file.fileUrl) return null;
          return {
            type: "task-file" as const,
            id: file.id,
            name: file.name,
            fileUrl: file.fileUrl,
            size: file.size ? Number(file.size) : null,
            mimeType: file.mimeType,
            updatedAt: file.updatedAt.toISOString(),
          };
        })
        .filter(
          (
            item,
          ): item is {
            type: "task-file";
            id: string;
            name: string;
            fileUrl: string;
            size: number | null;
            mimeType: string | null;
            updatedAt: string;
          } => item !== null,
        );

      const paginationMeta = createPaginationMeta(
        pagedFiles,
        taskFileCount,
        take,
        hasMore,
        cursor,
      );
      return ok(c, driveTasksListSchema.parse(items), paginationMeta);
    }

    if (projectId !== undefined) {
      // Level 2: Task rows with files, sorted by latest file updatedAt desc
      const projectFilter =
        projectId === "null" ? { projectId: null } : { projectId };

      const tasksWhere = {
        ...baseTaskWhere,
        ...projectFilter,
      };

      // Fetch all tasks (up to a reasonable limit for sorting)
      // Cursor pagination requires knowing position in sorted order
      const MAX_TASKS_FOR_SORT = 10000;
      const [allTasks, count] = await Promise.all([
        prisma.task.findMany({
          where: tasksWhere,
          take: MAX_TASKS_FOR_SORT,
          include: {
            files: {
              where: {
                status: "READY",
                fileUrl: { not: null },
              },
              orderBy: { updatedAt: "desc" },
              take: 1,
            },
          },
        }),
        prisma.task.count({ where: tasksWhere }),
      ]);

      // Sort by latest file updatedAt desc (spec requirement)
      const sortedTasks = allTasks.sort((a, b) => {
        const aFileTime = a.files[0]?.updatedAt.getTime() ?? 0;
        const bFileTime = b.files[0]?.updatedAt.getTime() ?? 0;

        if (bFileTime !== aFileTime) return bFileTime - aFileTime;
        return b.id.localeCompare(a.id); // Stable sort by id desc
      });

      // Apply cursor pagination on sorted list
      let startIndex = 0;
      if (cursor) {
        const cursorIndex = sortedTasks.findIndex((t) => t.id === cursor);
        if (cursorIndex >= 0) {
          startIndex = cursorIndex + 1; // Skip cursor item
        }
      }
      startIndex += skip ?? 0;

      const pagedTasks = sortedTasks.slice(startIndex, startIndex + take);
      const hasMore = startIndex + take < sortedTasks.length;

      const items: DriveTasksListItem[] = pagedTasks.map((task) => {
        const fileTime = task.files[0]?.updatedAt.getTime() ?? 0;

        return {
          type: "task",
          id: task.id,
          name: task.name,
          latestFileUpdatedAt: new Date(fileTime).toISOString(),
        };
      });

      const paginationMeta = createPaginationMeta(
        pagedTasks,
        count,
        take,
        hasMore,
        cursor,
      );
      return ok(c, driveTasksListSchema.parse(items), paginationMeta);
    }

    // Level 1: Project rows + no-project row, sorted by latest file updatedAt desc
    // Key project rows by tasks in the Drive workspace, not by Project.workspaceId
    // (transferred tasks may have Task.workspaceId !== Project.workspaceId)

    // Find non-null projectIds from tasks matching baseTaskWhere
    const tasksWithProjects = await prisma.task.findMany({
      where: {
        ...baseTaskWhere,
        projectId: { not: null },
      },
      select: { projectId: true },
    });

    // Unique in memory
    const projectIds = Array.from(
      new Set(
        tasksWithProjects
          .map((t) => t.projectId)
          .filter((id): id is string => id !== null),
      ),
    );

    // Fetch all projects by id + no-project count
    const MAX_PROJECTS_FOR_SORT = 10000;
    const [allProjects, noProjectTasksCount] = await Promise.all([
      projectIds.length > 0
        ? prisma.project.findMany({
            where: {
              id: { in: projectIds },
            },
            take: MAX_PROJECTS_FOR_SORT,
            include: {
              tasks: {
                where: baseTaskWhere,
                include: {
                  files: {
                    where: {
                      status: "READY",
                      fileUrl: { not: null },
                    },
                    orderBy: { updatedAt: "desc" },
                    take: 1,
                  },
                },
                orderBy: [{ updatedAt: "desc" }],
                take: 1,
              },
            },
          })
        : Promise.resolve([]),
      prisma.task.count({
        where: {
          ...baseTaskWhere,
          projectId: null,
        },
      }),
    ]);

    // Build map of found projects
    const projectMap = new Map(allProjects.map((p) => [p.id, p]));

    // Emit project rows for all projectIds, using fallback for missing projects
    const projectsToEmit = projectIds.map((id) => {
      const project = projectMap.get(id);
      return {
        id,
        name: project?.name ?? `[Project ${id.slice(0, 8)}]`,
        tasks: project?.tasks ?? [],
      };
    });

    // Build combined list: projects + no-project row
    interface SortableItem {
      type: "project" | "no-project";
      id: string;
      name?: string;
      latestFileUpdatedAt: string;
      latestFileTime: number;
    }

    const sortableItems: SortableItem[] = projectsToEmit.map((project) => {
      // Find latest file time across all tasks in project
      let latestTime = 0;
      for (const task of project.tasks) {
        const fileTime = task.files[0]?.updatedAt.getTime() ?? 0;
        latestTime = Math.max(latestTime, fileTime);
      }

      const latestFileUpdatedAt =
        latestTime > 0
          ? new Date(latestTime).toISOString()
          : new Date().toISOString();

      return {
        type: "project" as const,
        id: project.id,
        name: project.name,
        latestFileUpdatedAt,
        latestFileTime: latestTime,
      };
    });

    // Add no-project row if it has tasks with files
    if (noProjectTasksCount > 0) {
      // Find latest file time for no-project tasks
      const latestNoProjectFile = await prisma.taskFile.findFirst({
        where: {
          task: {
            ...baseTaskWhere,
            projectId: null,
          },
          status: "READY",
          fileUrl: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      });

      const fileTime = latestNoProjectFile?.updatedAt.getTime() ?? 0;

      const latestFileUpdatedAt =
        fileTime > 0
          ? new Date(fileTime).toISOString()
          : new Date().toISOString();

      sortableItems.push({
        type: "no-project",
        id: "null",
        latestFileUpdatedAt,
        latestFileTime: fileTime,
      });
    }

    // Sort all items by latest file/blob updatedAt desc (spec requirement)
    sortableItems.sort((a, b) => {
      if (b.latestFileTime !== a.latestFileTime) {
        return b.latestFileTime - a.latestFileTime;
      }
      return b.id.localeCompare(a.id); // Stable sort by id desc
    });

    // Apply cursor pagination on sorted combined list
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = sortableItems.findIndex((item) => item.id === cursor);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1; // Skip cursor item
      }
    }
    startIndex += skip ?? 0;

    const pagedItems = sortableItems.slice(startIndex, startIndex + take);
    const hasMore = startIndex + take < sortableItems.length;

    const items: DriveTasksListItem[] = pagedItems.map((item) => {
      if (item.type === "project") {
        return {
          type: "project",
          id: item.id,
          name: item.name!,
          latestFileUpdatedAt: item.latestFileUpdatedAt,
        };
      } else {
        return {
          type: "no-project",
          id: "null",
          latestFileUpdatedAt: item.latestFileUpdatedAt,
        };
      }
    });

    const totalCount = sortableItems.length;
    const paginationMeta = createPaginationMeta(
      pagedItems,
      totalCount,
      take,
      hasMore,
      cursor,
    );
    return ok(c, driveTasksListSchema.parse(items), paginationMeta);
  });
}
