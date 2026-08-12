import { createRoute } from "@hono/zod-openapi";

import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { getTransactionHistory } from "@/helpers/transaction-history";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrchestratorContextHeaderParameters,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  transactionHistoryListResponseExample,
  transactionHistoryListSchema,
} from "@/schemas/transaction.schema";

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List credit transaction history for the active workspace (paginated). An organization workspace pools every member's transactions; a personal workspace is scoped to the current user.",
    tags: ["Transactions"],
    request: {
      query: cursorPaginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        transactionHistoryListSchema,
        "Retrieve transaction history",
        transactionHistoryListResponseExample,
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    const { items, count, hasMore } = await getTransactionHistory(
      workspaceContext,
      { cursor, take, skip },
      prisma,
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
