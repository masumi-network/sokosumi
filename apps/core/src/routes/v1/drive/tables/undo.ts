import { createRoute, z } from "@hono/zod-openapi";
import { undoTableBatch } from "@/helpers/data-table";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { tableBatchResultSchema } from "@/schemas/data-table.schema";
import { tableActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/undo",
    tags: ["Tables"],
    request: {
      headers: z.object({
        "X-Table-Task-Id": z.string().max(200).optional().openapi({
          description:
            "Assigned task context. Required for direct coworker and Soko Bot table operations; enforces persisted selected-row scope.",
        }),
      }),
      params: z.object({ id: z.uuid() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              key: z.string().min(1).max(200),
              batchId: z.uuid(),
            }),
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        tableBatchResultSchema,
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
    return ok(
      c,
      await undoTableBatch(actor, c.req.valid("param").id, c.req.valid("json")),
    );
  });
}
