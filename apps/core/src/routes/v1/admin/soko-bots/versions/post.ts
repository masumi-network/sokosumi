import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  sokoBotVersionDetailSchema,
  sokoBotVersionWriteSchema,
} from "@/schemas/soko-bot.schema";
import {
  createAuthoredVersion,
  getDefaultSokoBotVersionId,
} from "@/services/soko-bot-version.service";
import { versionDetail } from "../helpers.js";

const createVersionRoute = createRoute({
  method: "post",
  path: "/versions",
  operationId: "createAdminSokoBotVersion",
  tags: ["Admin"],
  request: {
    body: {
      content: { "application/json": { schema: sokoBotVersionWriteSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotVersionDetailSchema, "Created version"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Version id already in use"),
    422: jsonErrorResponse("Validation error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(createVersionRoute, async (c) => {
    const auth = requireAdminAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    const version = await createAuthoredVersion(body, auth.userId);
    return ok(
      c,
      versionDetail(version, true, await getDefaultSokoBotVersionId()),
    );
  });
}
