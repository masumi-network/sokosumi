import { createRoute } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import {
  buildOrganizationDriveFilePrefix,
  buildUserDriveFilePrefix,
} from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { requireCoworkerCapability } from "@/helpers/access-control";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import {
  fetchDriveRecentsPage,
  resolveDriveRecentsSort,
} from "@/helpers/drive-recents";
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
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { isCoworkerAuthContext, requireUserContext } from "@/middleware/auth";
import { resolveDriveListSort } from "@/schemas/drive-list-sort.schema";
import {
  driveRecentsListSchema,
  driveRecentsQuerySchema,
} from "@/schemas/drive-recents.schema";
import type { CursorPaginationMeta } from "@/schemas/pagination.schema";

const route = createRoute({
  method: "get",
  path: "/",
  description: [
    "List recent Drive files and task/agent outputs for the active workspace.",
    "Returns a flat, activity-sorted file list with cursor pagination.",
    "Mixes Drive blob uploads at any folder depth with READY TASK_OUTPUT TaskFiles.",
    "Omit sortBy/sortOrder for today's default: activityAt descending.",
    "sortBy=date (or sortOrder alone) flips activityAt direction.",
    "sortBy=name|type never replaces activityAt as primary — they are secondary keys only",
    "(activityAt, secondary, id) with stable kind/id tie-breakers.",
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
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const query = c.req.valid("query");
    const userContext = requireUserContext(authContext);

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
    const listSort = resolveDriveListSort(query, "date");
    const sort = resolveDriveRecentsSort(listSort);

    const page = await fetchDriveRecentsPage({
      prefix,
      token,
      limit: take,
      cursor,
      cursorSecret: env.BETTER_AUTH_SECRET,
      cursorBinding: {
        prefix,
        searchQuery: searchQuery ?? "",
        sortFingerprint: "",
      },
      sort,
      ...(searchQuery ? { searchQuery } : {}),
      fetchTaskOutputs: ({ cursor: taskCursor, take: taskTake }) =>
        fetchDriveTaskOutputRecentsBatch({
          baseTaskWhere,
          cursor: taskCursor,
          take: taskTake,
          ...(searchQuery ? { searchQuery } : {}),
        }),
    });

    const paginationMeta: CursorPaginationMeta = {
      cursor: cursor ?? null,
      limit: take,
      total: page.items.length,
      nextCursor: page.nextCursor,
    };

    return ok(c, driveRecentsListSchema.parse(page.items), paginationMeta);
  });
}
