import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  restyleSokoBotAvatarsRequestSchema,
  restyleSokoBotAvatarsResultSchema,
} from "@/schemas/soko-bot-avatar.schema";
import { restyleAvatars } from "@/services/soko-bot-avatar.service";

const restyleAvatarsRoute = createRoute({
  method: "post",
  path: "/avatars/restyle",
  operationId: "restyleAdminSokoBotAvatars",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": { schema: restyleSokoBotAvatarsRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      restyleSokoBotAvatarsResultSchema,
      "How many avatars were redrawn and how many are left",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

/** Move bots off avatars drawn before the brand palette, a few per call. */
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(restyleAvatarsRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    return ok(c, await restyleAvatars(c.req.valid("json").limit));
  });
}
