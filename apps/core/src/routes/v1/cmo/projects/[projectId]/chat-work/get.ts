import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoChatWorkSchema,
  cmoProjectParamsSchema,
} from "@/schemas/cmo.schema";
import { listCmoChatWork } from "@/services/cmo-chat-work.service";

const route = createRoute({
  method: "get",
  path: "/projects/{projectId}/chat-work",
  operationId: "getCmoChatWorkForProject",
  tags: ["CMO"],
  description:
    "The pictures, videos and voice-overs Cuso started for the owner in chat, newest first, each with where it stands now. CMO's chat shows each one where it was asked for: while it is being made, and the file itself once it is.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoChatWorkSchema, "What Cuso made in chat"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const items = await listCmoChatWork({ userId, projectId }).catch(rethrow);
    return ok(c, { items });
  });
}
