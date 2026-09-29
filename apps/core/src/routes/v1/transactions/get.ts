import { createRoute } from "@hono/zod-openapi";

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
  transactionHistoryListResponseExample,
  transactionHistoryListSchema,
} from "@/schemas/transaction-history.schema";

import { transactionFilterQuerySchema } from "./query.js";

const query = transactionFilterQuerySchema.extend(
  cursorPaginationQuerySchema.shape,
);

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
