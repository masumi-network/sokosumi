import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoCusoSchema } from "@/schemas/cmo.schema";
import { listCusosForUser } from "@/services/cmo-cuso.service";

const route = createRoute({
  method: "get",
  path: "/cusos",
  operationId: "listCmoCusos",
  tags: ["CMO"],
  description:
    "Every live Cuso the caller can work with, in all their organizations, newest first. CMO picks among them (ADR 0065).",
  responses: {
    200: jsonSuccessResponse(z.array(cmoCusoSchema), "The caller's Cusos"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return ok(c, z.array(cmoCusoSchema).parse(await listCusosForUser(userId)));
  });
}
