import { createRoute, z } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";

import {
  requireCoworkerCapability,
  requireTaskReadForRouteVars,
} from "@/helpers/access-control";
import { fetchProjectTasksPage } from "@/helpers/drive-tasks-project-list";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
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

const DRIVE_TASK_FILE_WHERE = {
  status: "READY",
  origin: "TASK_OUTPUT",
  fileUrl: { not: null },
} as const;

/** Stable sort key when a row has no READY task-output files yet. */
const NO_DRIVE_TASK_FILE_SORT_EPOCH = new Date(0).toISOString();

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
    q: z
      .string()
      .optional()
      .openapi({
        param: { name: "q", in: "query" },
        description:
          "Search tasks and files by task name, task description, or file name (case-insensitive substring). Returns matching task-file rows.",
        example: "mockup",
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
    "List Drive Tasks (virtual folder over READY TASK_OUTPUT TaskFiles). One level at a time:",
    "- No projectId, no taskId → project rows (+ no-project row when unscoped tasks have files)",
    "- projectId set, no taskId → task rows with output files",
    "- taskId set → TASK_OUTPUT TaskFile rows",
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
    const { scope, organizationId, projectId, taskId, assigneeId, q } =
      queryParams;
    const searchQuery = q?.trim();
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    if (isCoworkerAuthContext(authContext)) {
      await requireCoworkerCapability(authContext.coworkerId, "tasks");
      if (!authContext.context) {
        throw forbidden("Drive Tasks requires workspace context");
      }
    }

    const userContext = requireUserContext(authContext);
    const workspaceContext = await resolveDriveTasksWorkspace({
      userContext,
      scope,
      organizationId,
    });
    c.set("workspaceContext", workspaceContext);
    const workspaceId = workspaceContext.workspaceId;

    const baseTaskWhere: Prisma.TaskWhereInput = {
      archivedAt: null,
      workspaceId,
      ...(assigneeId ? { assigneeId } : {}),
      files: {
        some: DRIVE_TASK_FILE_WHERE,
      },
    };

    // Apply coworker access filter if needed
    let coworkerAccess:
      | {
          coworkerId: string;
          vendorId: string;
          hasWorkspaceGrant: boolean;
        }
      | undefined;

    if (isCoworkerAuthContext(authContext) && authContext.context) {
      const hasWorkspaceGrant = await hasGrantedWorkspaceAccess({
        vendorId: authContext.vendorId,
        workspaceId,
      });

      coworkerAccess = {
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        hasWorkspaceGrant,
      };

      const listAccessFilter = buildCoworkerTaskListAccessFilter({
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        hasWorkspaceGrant,
      });

      baseTaskWhere.AND = [listAccessFilter];
    }

    if (searchQuery) {
      const taskFileWhere: Prisma.TaskFileWhereInput = {
        ...DRIVE_TASK_FILE_WHERE,
        OR: [
          {
            name: { contains: searchQuery, mode: "insensitive" },
            task: baseTaskWhere,
          },
          {
            task: {
              AND: [
                baseTaskWhere,
                {
                  OR: [
                    { name: { contains: searchQuery, mode: "insensitive" } },
                    {
                      description: {
                        contains: searchQuery,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      };

      if (cursor) {
        const cursorFile = await prisma.taskFile.findFirst({
          where: {
            id: cursor,
            ...taskFileWhere,
          },
          select: { id: true },
        });
        if (!cursorFile) {
          throw badRequest("Invalid pagination cursor");
        }
      }

      const takePlusOne = take + 1;
      const [matchingFiles, totalCount] = await Promise.all([
        prisma.taskFile.findMany({
          where: taskFileWhere,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          include: {
            task: {
              select: {
                id: true,
                name: true,
                projectId: true,
                project: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        }),
        prisma.taskFile.count({ where: taskFileWhere }),
      ]);

      const hasMore = matchingFiles.length === takePlusOne;
      const pagedFiles = matchingFiles.slice(0, take);

      const items: DriveTasksListItem[] = pagedFiles
        .map((file) => {
          if (!file.fileUrl) {
            return null;
          }

          return {
            type: "task-file" as const,
            id: file.id,
            name: file.name,
            fileUrl: file.fileUrl,
            size: file.size ? Number(file.size) : null,
            mimeType: file.mimeType,
            updatedAt: file.updatedAt.toISOString(),
            taskId: file.task.id,
            taskName: file.task.name,
            projectId: file.task.projectId,
            projectName: file.task.project?.name ?? null,
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
            taskId: string;
            taskName: string;
            projectId: string | null;
            projectName: string | null;
          } => item !== null,
        );

      const paginationMeta = createPaginationMeta(
        pagedFiles,
        totalCount,
        take,
        hasMore,
        cursor,
      );
      return ok(c, driveTasksListSchema.parse(items), paginationMeta);
    }

    // Determine level
    if (taskId) {
      await requireTaskReadForRouteVars(c.var, taskId);

      const taskFileWhere = {
        taskId,
        ...DRIVE_TASK_FILE_WHERE,
      };

      if (cursor) {
        const cursorFile = await prisma.taskFile.findFirst({
          where: {
            id: cursor,
            ...taskFileWhere,
          },
          select: { id: true },
        });
        if (!cursorFile) {
          throw badRequest("Invalid pagination cursor");
        }
      }

      const takePlusOne = take + 1;
      const [taskFiles, taskFileCount] = await Promise.all([
        prisma.taskFile.findMany({
          where: taskFileWhere,
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        }),
        prisma.taskFile.count({
          where: taskFileWhere,
        }),
      ]);

      const hasMore = taskFiles.length === takePlusOne;
      const pagedFiles = taskFiles.slice(0, take);

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
      const pageResult = await fetchProjectTasksPage({
        workspaceId,
        projectId: projectId === "null" ? null : projectId,
        ...(assigneeId ? { assigneeId } : {}),
        ...(coworkerAccess ? { coworkerAccess } : {}),
        ...(cursor ? { cursor } : {}),
        take,
      });

      if (!pageResult.ok) {
        throw badRequest("Invalid pagination cursor");
      }

      const hasMore = pageResult.rows.length === take + 1;
      const pagedTasks = pageResult.rows.slice(0, take);

      const items: DriveTasksListItem[] = pagedTasks.map((task) => ({
        type: "task",
        id: task.id,
        name: task.name,
        latestFileUpdatedAt: task.latestFileUpdatedAt.toISOString(),
      }));

      const paginationMeta = createPaginationMeta(
        pagedTasks,
        pageResult.totalCount,
        take,
        hasMore,
        cursor,
      );
      return ok(c, driveTasksListSchema.parse(items), paginationMeta);
    }

    // Level 1: Project rows + no-project row, sorted by latest file updatedAt desc
    // Key project rows by tasks in the Drive workspace, not by Project.workspaceId
    // (transferred tasks may have Task.workspaceId !== Project.workspaceId)

    const projectIdGroups = await prisma.task.groupBy({
      by: ["projectId"],
      where: {
        ...baseTaskWhere,
        projectId: { not: null },
      },
    });

    const projectIds = projectIdGroups
      .map((group) => group.projectId)
      .filter((id): id is string => id !== null);

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
                    where: DRIVE_TASK_FILE_WHERE,
                    orderBy: { updatedAt: "desc" },
                    take: 1,
                  },
                },
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
          : NO_DRIVE_TASK_FILE_SORT_EPOCH;

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
          ...DRIVE_TASK_FILE_WHERE,
        },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      });

      const fileTime = latestNoProjectFile?.updatedAt.getTime() ?? 0;

      const latestFileUpdatedAt =
        fileTime > 0
          ? new Date(fileTime).toISOString()
          : NO_DRIVE_TASK_FILE_SORT_EPOCH;

      sortableItems.push({
        type: "no-project",
        id: "null",
        latestFileUpdatedAt,
        latestFileTime: fileTime,
      });
    }

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
      if (cursorIndex < 0) {
        throw badRequest("Invalid pagination cursor");
      }
      startIndex = cursorIndex + 1; // Skip cursor item
    }

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
