import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoCusoListSchema } from "@/schemas/cmo.schema";
import { listCusosForUser } from "@/services/cmo-cuso.service";
import { mayHireCuso } from "@/services/cmo-hiring.service";

const route = createRoute({
  method: "get",
  path: "/cusos",
  operationId: "listCmoCusos",
  tags: ["CMO"],
  description:
    "Every live Cuso the caller can work with, in all their organizations, newest first, and whether the caller may hire another. CMO picks among them (ADR 0065).",
  responses: {
    200: jsonSuccessResponse(
      cmoCusoListSchema,
      "The caller's Cusos and whether they may hire",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const [cusos, mayHire] = await Promise.all([
      listCusosForUser(userId),
      mayHireCuso(userId),
    ]);
    return ok(c, cmoCusoListSchema.parse({ cusos, mayHire }));
  });
}
