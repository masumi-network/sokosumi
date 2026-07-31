import { createRoute, z } from "@hono/zod-openapi";
import { HistoryKind } from "@sokosumi/database";

import { badRequest } from "@/helpers/error";
import {
  buildHistoryWhere,
  createHistoryPaginationMeta,
  loadAgentPreviewsByIds,
  loadComputedJobStatusByEntityId,
  loadUserPreviewsByIds,
  mapHistoryRow,
} from "@/helpers/history";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { parseCursorPagination } from "@/helpers/pagination";
import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  historyListResponseExample,
  historyListSchema,
} from "@/schemas/history.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

const historyScopeQuerySchema = z
  .enum(["workspace", "owned"])
  .default("owned")
  .openapi({
    param: { name: "scope", in: "query" },
    description: "Workspace visibility scope for task and job rows.",
    example: "workspace",
  });

const historySearchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .openapi({
    param: { name: "q", in: "query" },
    description: "Case-insensitive search across history title and description",
    example: "onboarding",
  });

const historyTypesQuerySchema = z
  .preprocess(
    preprocessMultiValueQueryInput,
    z
      .array(z.enum(["task", "job"]))
      .min(1)
      .optional()
      .transform(deduplicateQueryValues),
  )
  .openapi({
    param: { name: "types", in: "query" },
    description: "Comma-separated history kinds to include: task, job",
    example: "task,job",
  });

const historyStatusQuerySchema = z
  .preprocess(
    preprocessMultiValueQueryInput,
    z
      .array(z.string().trim().min(1))
      .min(1)
      .optional()
      .transform(deduplicateQueryValues),
  )
  .openapi({
    param: { name: "status", in: "query" },
    description:
      "Comma-separated status filters. Task statuses apply to tasks. Job statuses are resolved from computed job state. When `active` is the only filter, only non-archived rows match for kinds that support archived state.",
    example: "READY,completed",
  });

const projectIdQuerySchema = z
  .union([z.string().uuid(), z.literal("null")])
  .optional()
  .openapi({
    param: { name: "projectId", in: "query" },
    description:
      "Filter task and job history rows by project ID. Use 'null' for unassigned rows.",
    example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  });

const query = z
  .object({
    projectId: projectIdQuerySchema,
    q: historySearchQuerySchema,
    scope: historyScopeQuerySchema,
    status: historyStatusQuerySchema,
    types: historyTypesQuerySchema,
  })
  .extend(cursorPaginationQuerySchema.shape);

const historyKindByQueryType = {
  task: HistoryKind.TASK,
  job: HistoryKind.JOB,
} as const;

const allHistoryKinds = [HistoryKind.TASK, HistoryKind.JOB];

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: "List history feed items from the precomputed history table",
    tags: ["History"],
    request: {
      query,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        historyListSchema,
        "Retrieve history feed items",
        historyListResponseExample,
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const types =
      queryParams.types?.map((type) => historyKindByQueryType[type]) ??
      allHistoryKinds;
    const projectId =
      queryParams.projectId === "null" ? null : queryParams.projectId;
    const where = await buildHistoryWhere(
      {
        projectId,
        q: queryParams.q,
        scope: queryParams.scope,
        statuses: queryParams.status,
        types,
        userContext,
        workspaceContext,
      },
      prisma,
    );
    const takePlusOne = take + 1;
    const cursorHistoryId = cursor
      ? (
          await prisma.history.findFirst({
            where: { AND: [where, { entityId: cursor }] },
            select: { id: true },
            orderBy: [{ sortAt: "desc" }, { id: "desc" }],
          })
        )?.id
      : undefined;

    if (cursor && !cursorHistoryId) {
      throw badRequest("Invalid pagination cursor");
    }

    const [rows, count] = await prisma.$transaction([
      prisma.history.findMany({
        where,
        take: takePlusOne,
        skip: cursorHistoryId ? 1 : skip,
        cursor: cursorHistoryId ? { id: cursorHistoryId } : undefined,
        orderBy: [{ sortAt: "desc" }, { id: "desc" }],
      }),
      prisma.history.count({ where }),
    ]);

    const hasMore = rows.length === takePlusOne;
    const pagedRows = rows.slice(0, take);
    const jobRows = pagedRows.filter((row) => row.kind === HistoryKind.JOB);
    const jobEntityIds = jobRows.map((row) => row.entityId);
    const jobAgentIds = [
      ...new Set(
        jobRows
          .map((row) => row.agentId)
          .filter((agentId): agentId is string => agentId != null),
      ),
    ];
    const userIds = [...new Set(pagedRows.map((row) => row.userId))];
    const [jobStatusByEntityId, agentPreviewById, userPreviewById] =
      await Promise.all([
        loadComputedJobStatusByEntityId(jobEntityIds, prisma),
        loadAgentPreviewsByIds(jobAgentIds, prisma),
        loadUserPreviewsByIds(userIds, prisma),
      ]);
    const historyItems = pagedRows.map((row) =>
      mapHistoryRow(row, {
        jobStatusByEntityId,
        agentPreviewById,
        userPreviewById,
      }),
    );
    const paginationMeta = createHistoryPaginationMeta(
      historyItems,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(c, historyListSchema.parse(historyItems), paginationMeta);
  });
}
