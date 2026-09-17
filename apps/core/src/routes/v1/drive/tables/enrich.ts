import { createRoute, z } from "@hono/zod-openapi";
import { createTableEnrichment } from "@/helpers/data-table";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { tableActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/enrich",
    tags: ["Tables"],
    request: {
      headers: z.object({
        "X-Table-Task-Id": z.string().max(200).optional().openapi({
          description:
            "Assigned task context. Required for coworker table operations; enforces persisted selected-row scope.",
        }),
      }),
      params: z.object({ id: z.uuid() }),
      body: {
        content: {
          "application/json": {
            schema: z
              .object({
                key: z.string().min(1).max(200),
                prompt: z.string().trim().min(1).max(4000),
                rowIds: z.array(z.uuid()).min(1).max(100),
                columnIds: z.array(z.uuid()).min(1).max(100),
                assigneeId: z.string().optional(),
                assigneeSokoBotId: z.uuid().optional(),
              })
              .refine(
                (value) =>
                  Boolean(value.assigneeId) !==
                  Boolean(value.assigneeSokoBotId),
                "Choose one agent",
              ),
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        z.object({ taskId: z.string(), tableId: z.uuid() }),
        "Enrichment task created",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Invalid input"),
    },
  }),
);
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) =>
    ok(
      c,
      await createTableEnrichment(
        await tableActor(c),
        c.req.valid("param").id,
        c.req.valid("json"),
      ),
    ),
  );
}
