import { createRoute, z } from "@hono/zod-openapi";
import { listDataTables } from "@/helpers/data-table";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { dataTableSchema } from "@/schemas/data-table.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { tableActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Tables"],
    request: {
      headers: z.object({
        "X-Table-Task-Id": z.string().max(200).optional().openapi({
          description:
            "Assigned task context. Required for coworker table operations; enforces persisted selected-row scope.",
        }),
      }),
      query: cursorPaginationQuerySchema.extend({
        cursor: z.uuid().optional(),
        archived: z.enum(["true", "false"]).optional(),
        projectId: z.uuid().optional(),
      }),
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(dataTableSchema),
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
    const query = c.req.valid("query");
    const result = await listDataTables(actor, {
      ...query,
      archived: query.archived === "true",
    });
    return ok(c, result.items, {
      cursor: query.cursor ?? null,
      limit: query.limit,
      total: result.total,
      nextCursor: result.nextCursor,
    });
  });
}
