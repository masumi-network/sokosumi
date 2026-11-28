import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { creditViewForRequest } from "@/lib/credits/view";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { transactionTotalSchema } from "@/schemas/transaction-history.schema";
import {
  requireLedgerTaskFilter,
  transactionFilterQuerySchema,
} from "../query.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/total",
    description:
      "Net credits and row count for the credit ledger under the list's filters, such as everything one Task cost.",
    tags: ["Transactions"],
    request: {
      query: transactionFilterQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        transactionTotalSchema,
        "Retrieve the ledger total",
      ),
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
    const query = c.req.valid("query");
    await requireLedgerTaskFilter(
      workspaceContext,
      userContext.userId,
      query.taskId,
    );

    const total = await view.total({
      kinds: query.types,
      projectId: query.projectId === "null" ? null : query.projectId,
      q: query.q,
      scope: query.scope,
      taskId: query.taskId,
      userContext,
      workspaceContext,
    });

    return ok(c, total);
  });
}
