import { createRoute } from "@hono/zod-openapi";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { creditViewForRequest } from "@/lib/credits/view";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { NETWORKS } from "@/lib/network";
import { requireOwnerUserContext } from "@/middleware/auth";
import { NETWORK_HEADER } from "@/middleware/network-scope";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  requireLedgerTaskFilter,
  toInstantRange,
  transactionDateRangeQuerySchema,
  transactionFilterQuerySchema,
} from "../query.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/export",
    description:
      "Download the credit ledger for a UTC day range as CSV, newest first. Columns: date (ISO 8601), source, label, credits (spends negative, top ups positive). The last three rows are totals with source `total`. Takes the same filters as the list.",
    tags: ["Transactions"],
    request: {
      query: transactionFilterQuerySchema.extend(
        transactionDateRangeQuerySchema.shape,
      ),
    },
    responses: {
      200: {
        description: "Ledger rows as CSV",
        headers: {
          [NETWORK_HEADER]: {
            description: "Network of the exported ledger.",
            schema: { type: "string", enum: [...NETWORKS] },
          },
        },
        content: { "text/csv": { schema: { type: "string" } } },
      },
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Task not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const view = creditViewForRequest(c.var.networkScope);
    const userContext = requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { from, to, projectId, ...filters } = c.req.valid("query");
    await requireLedgerTaskFilter(
      workspaceContext,
      userContext.userId,
      filters.taskId,
    );
    const range = toInstantRange({ from, to });

    if (!range) {
      throw badRequest("`from` must not be after `to`");
    }

    const stream = view.csv({
      ...range,
      kinds: filters.types,
      projectId: projectId === "null" ? null : projectId,
      q: filters.q,
      taskId: filters.taskId,
      scope: filters.scope,
      userContext,
      workspaceContext,
    });

    return c.body(stream, 200, {
      [NETWORK_HEADER]: view.network,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="transactions-${from ?? "start"}_${to ?? "today"}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
  });
}
