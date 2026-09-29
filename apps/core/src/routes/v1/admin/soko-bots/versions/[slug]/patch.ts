import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  sokoBotVersionDetailSchema,
  sokoBotVersionWriteSchema,
} from "@/schemas/soko-bot.schema";
import {
  getDefaultSokoBotVersionId,
  updateAuthoredVersion,
} from "@/services/soko-bot-version.service";
import { versionDetail } from "../../helpers.js";

const updateVersionRoute = createRoute({
  method: "patch",
  path: "/versions/{slug}",
  operationId: "updateAdminSokoBotVersion",
  tags: ["Admin"],
  request: {
    params: z.object({ slug: z.string().min(2).max(41) }),
    body: {
      content: {
        "application/json": {
          schema: sokoBotVersionWriteSchema.omit({ slug: true }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotVersionDetailSchema, "Updated version"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
    422: jsonErrorResponse("Validation error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(updateVersionRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { slug } = c.req.valid("param");
    const version = await updateAuthoredVersion(slug, c.req.valid("json"));
    return ok(
      c,
      versionDetail(version, true, await getDefaultSokoBotVersionId()),
    );
  });
}
