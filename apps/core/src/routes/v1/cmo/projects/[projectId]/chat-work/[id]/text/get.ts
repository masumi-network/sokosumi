import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoChatWorkIdParamsSchema,
  cmoPieceTextSchema,
} from "@/schemas/cmo.schema";
import { readCmoChatWorkText } from "@/services/cmo-chat-work.service";

const route = createRoute({
  method: "get",
  path: "/projects/{projectId}/chat-work/{id}/text",
  operationId: "getCmoChatWorkTextForProject",
  tags: ["CMO"],
  description:
    "The full words of one thing Cuso made or handed on in chat, for reading inside CMO: a file he wrote, or what a Coworker or a hired Agent came back with.",
  request: { params: cmoChatWorkIdParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoPieceTextSchema, "Its words"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Nothing to read yet, or Cuso is not hired"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    const text = await readCmoChatWorkText({ userId, projectId, id }).catch(
      rethrow,
    );
    return ok(c, { text });
  });
}
