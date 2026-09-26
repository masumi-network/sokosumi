import { createRoute, z } from "@hono/zod-openapi";
import { tableQuerySchema } from "@sokosumi/utils";
import { queryTableRows } from "@/helpers/data-table";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { tableRowSchema } from "@/schemas/data-table.schema";
import { tableActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/query",
    tags: ["Tables"],
    request: {
      headers: z.object({
        "X-Table-Task-Id": z.string().max(200).optional().openapi({
          description:
            "Assigned task context. Required for direct coworker and Soko Bot table operations; enforces persisted selected-row scope.",
        }),
      }),
      params: z.object({ id: z.uuid() }),
      body: { content: { "application/json": { schema: tableQuerySchema } } },
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(tableRowSchema),
        "Table operation completed",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Invalid table input"),
    },
  }),
);
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await tableActor(c);
    const query = c.req.valid("json");
    const result = await queryTableRows(actor, c.req.valid("param").id, query);
    return ok(c, result.rows, {
      cursor: query.cursor ?? null,
      limit: query.limit,
      total: result.total,
      nextCursor: result.nextCursor,
    });
  });
}
