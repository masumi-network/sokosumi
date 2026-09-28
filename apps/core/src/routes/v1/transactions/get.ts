import { createRoute, z } from "@hono/zod-openapi";

import {
  loadAgentPreviewsByIds,
  loadUserPreviewsByIds,
} from "@/helpers/history";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import { ok } from "@/helpers/response";
import {
  countTransactionHistory,
  findTransactionHistoryPage,
  mapTransactionHistoryRow,
} from "@/helpers/transaction-history";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  transactionHistoryKinds,
  transactionHistoryListResponseExample,
  transactionHistoryListSchema,
} from "@/schemas/transaction-history.schema";

const scopeQuerySchema = z
  .enum(["workspace", "owned"])
  .default("owned")
  .openapi({
    param: { name: "scope", in: "query" },
    description:
      "owned: only ledger rows belonging to the calling user. workspace: every ledger row in the active workspace, including organization-level ones with no user.",
    example: "workspace",
  });

const searchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .openapi({
    param: { name: "q", in: "query" },
    description:
      "Case-insensitive search across the labels a row can carry: job, agent, task, coworker and image model names, task event comments, image prompts and top up bucket notes.",
    example: "onboarding",
  });

const typesQuerySchema = z
  .preprocess(
    preprocessMultiValueQueryInput,
    z
      .array(z.enum(transactionHistoryKinds))
      .min(1)
      .optional()
      .transform(deduplicateQueryValues),
  )
  .openapi({
    param: { name: "types", in: "query" },
    description:
      "Comma-separated ledger sources to include: job, image, task, coworker, sokoBot, topUp, unattributed. `topUp` are credits added to the account; every other kind takes credits. `unattributed` are spends with no entity relation at all.",
    example: "job,image",
  });

const projectIdQuerySchema = z
  .union([z.string().uuid(), z.literal("null")])
  .optional()
  .openapi({
    param: { name: "projectId", in: "query" },
    description:
      "Filter ledger rows by project. Use 'null' for rows with no project, which includes every coworker, Soko Bot, top up and unattributed row.",
    example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  });

const query = z
  .object({
    projectId: projectIdQuerySchema,
    q: searchQuerySchema,
    scope: scopeQuerySchema,
    types: typesQuerySchema,
  })
  .extend(cursorPaginationQuerySchema.shape);

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List the credit ledger for the active workspace, newest first. One row is one transaction: a spend, or a top up that added credits.",
    tags: ["Transactions"],
    request: {
      query,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        transactionHistoryListSchema,
        "Retrieve credit ledger rows",
        transactionHistoryListResponseExample,
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
    const userContext = requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const queryParams = c.req.valid("query");
    const { cursor, take } = parseCursorPagination(queryParams);
    const params = {
      kinds: queryParams.types,
      projectId:
        queryParams.projectId === "null" ? null : queryParams.projectId,
      q: queryParams.q,
      scope: queryParams.scope,
      userContext,
      workspaceContext,
    };

    const [{ rows, hasMore }, count] = await Promise.all([
      findTransactionHistoryPage(params, { cursor, take }, prisma),
      countTransactionHistory(params, prisma),
    ]);

    const agentIds = [
      ...new Set(
        rows
          .map((row) => row.agentId)
          .filter((agentId): agentId is string => agentId != null),
      ),
    ];
    const userIds = [
      ...new Set(
        rows
          .map((row) => row.userId)
          .filter((userId): userId is string => userId != null),
      ),
    ];
    const [agentPreviewById, userPreviewById] = await Promise.all([
      loadAgentPreviewsByIds(agentIds, prisma),
      loadUserPreviewsByIds(userIds, prisma),
    ]);
    const items = rows.map((row) =>
      mapTransactionHistoryRow(row, { agentPreviewById, userPreviewById }),
    );
    const paginationMeta = createPaginationMeta(
      items,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(c, transactionHistoryListSchema.parse(items), paginationMeta);
  });
}
