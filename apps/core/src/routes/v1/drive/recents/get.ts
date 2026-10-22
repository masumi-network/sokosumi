import { createRoute } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import {
  buildOrganizationDriveFilePrefix,
  buildUserDriveFilePrefix,
} from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { requireCoworkerCapability } from "@/helpers/access-control";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { listDataTables, resolveTableActor } from "@/helpers/data-table";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { fetchDriveRecentsPage } from "@/helpers/drive-recents";
import { driveActorTaskWhere } from "@/helpers/drive-task-actor-visibility";
import {
  DRIVE_TASK_FILE_WHERE,
  fetchDriveTaskOutputRecentsBatch,
} from "@/helpers/drive-task-output-catalog";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import { badRequest, forbidden, serviceUnavailable } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { parseCursorPagination } from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import {
  buildCoworkerTaskListAccessFilter,
  hasGrantedWorkspaceAccess,
} from "@/helpers/vendor-grants";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { isCoworkerAuthContext, isUserAuthContext } from "@/middleware/auth";
import {
  driveRecentsListSchema,
  driveRecentsQuerySchema,
} from "@/schemas/drive-recents.schema";
import type { CursorPaginationMeta } from "@/schemas/pagination.schema";
import { contactsDriveEntry } from "@/services/contacts.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: [
      "List recent Drive files and task/agent outputs for the active workspace.",
      "Returns a flat, activity-sorted file list (newest first) with cursor pagination.",
      "Mixes Drive blob uploads at any folder depth with READY TASK_OUTPUT TaskFiles and, for people, live tables.",
      "For people, the first page starts with the workspace's pinned Contacts entry (kind `contacts`) unless a search excludes it.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      query: driveRecentsQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        driveRecentsListSchema,
        "Drive recents retrieved",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const query = c.req.valid("query");
    const userContext = await requireAuthorizedUserContext(authContext);

    if (isCoworkerAuthContext(authContext)) {
      await requireCoworkerCapability(authContext.coworkerId, "tasks");
      if (!authContext.context) {
        throw forbidden("Drive recents requires workspace context");
      }
    }

    const env = getEnv();
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    let prefix: string;
    let scope: "user" | "organization";
    let ownerId: string;

    if (query.scope === "me") {
      ownerId = userContext.userId;
      scope = "user";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildUserDriveFilePrefix(ownerId);
    } else if (query.scope === "org") {
      ownerId = query.organizationId!;
      scope = "organization";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildOrganizationDriveFilePrefix(ownerId);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    const workspaceContext = await resolveDriveTasksWorkspace({
      userContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });
    c.set("workspaceContext", workspaceContext);

    const baseTaskWhere: Prisma.TaskWhereInput = {
      archivedAt: null,
      workspaceId: workspaceContext.workspaceId,
      files: {
        some: DRIVE_TASK_FILE_WHERE,
      },
      ...driveActorTaskWhere(authContext, userContext.userId),
    };

    if (isCoworkerAuthContext(authContext) && authContext.context) {
      const hasWorkspaceGrant = await hasGrantedWorkspaceAccess({
        vendorId: authContext.vendorId,
        workspaceId: workspaceContext.workspaceId,
      });
      const listAccessFilter = buildCoworkerTaskListAccessFilter({
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        hasWorkspaceGrant,
      });
      baseTaskWhere.AND = [listAccessFilter];
    }

    const { cursor, take } = parseCursorPagination(query);
    const searchQuery = query.q?.trim();
    // Agents reach tables only through a task's scope, never a workspace list.
    const tableActor = isUserAuthContext(authContext)
      ? await resolveTableActor(authContext, workspaceContext.workspaceId)
      : null;

    const page = await fetchDriveRecentsPage({
      prefix,
      token,
      limit: take,
      cursor,
      cursorSecret: env.BETTER_AUTH_SECRET,
      cursorBinding: {
        prefix,
        searchQuery: searchQuery ?? "",
      },
      ...(searchQuery ? { searchQuery } : {}),
      fetchTaskOutputs: ({ cursor: taskCursor, take: taskTake }) =>
        fetchDriveTaskOutputRecentsBatch({
          baseTaskWhere,
          cursor: taskCursor,
          take: taskTake,
          ...(searchQuery ? { searchQuery } : {}),
        }),
      ...(tableActor
        ? {
            fetchTables: async ({ cursor: tableCursor, take: tableTake }) => {
              const tables = await listDataTables(tableActor, {
                cursor: tableCursor,
                limit: tableTake,
                search: searchQuery,
              });
              return {
                items: tables.items.map((table) => ({
                  kind: "table" as const,
                  tableId: table.id,
                  name: table.title,
                  activityAt: table.updatedAt,
                  projectId: table.projectId,
                })),
                hasMore: tables.nextCursor !== null,
                nextCursor: tables.nextCursor,
              };
            },
          }
        : {}),
    });

    // The contacts set is one pinned entry per workspace, not a file: it heads
    // the first page and matches a search for its name.
    const contacts =
      tableActor &&
      !cursor &&
      (!searchQuery || "contacts".includes(searchQuery.toLowerCase()))
        ? await contactsDriveEntry(workspaceContext.workspaceId)
        : null;
    const items = contacts
      ? [
          {
            kind: "contacts" as const,
            name: "Contacts",
            pinned: true as const,
            ...contacts,
          },
          ...page.items,
        ]
      : page.items;

    const paginationMeta: CursorPaginationMeta = {
      cursor: cursor ?? null,
      limit: take,
      total: items.length,
      nextCursor: page.nextCursor,
    };

    return ok(c, driveRecentsListSchema.parse(items), paginationMeta);
  });
}
