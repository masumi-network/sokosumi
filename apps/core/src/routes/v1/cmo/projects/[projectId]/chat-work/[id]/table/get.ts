import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoChatWorkIdParamsSchema,
  cmoChatWorkTableSchema,
} from "@/schemas/cmo.schema";
import { readCmoChatWorkTable } from "@/services/cmo-chat-work.service";

const route = createRoute({
  method: "get",
  path: "/projects/{projectId}/chat-work/{id}/table",
  operationId: "getCmoChatWorkTableForProject",
  tags: ["CMO"],
  description:
    "A table Cuso made or wrote into in chat, with up to 200 of its rows, for showing all of it inside CMO.",
  request: { params: cmoChatWorkIdParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoChatWorkTableSchema, "The table"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("No such table, or Cuso is not hired"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    const found = await readCmoChatWorkTable({ userId, projectId, id }).catch(
      rethrow,
    );
    return ok(c, found);
  });
}
