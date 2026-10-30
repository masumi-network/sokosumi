import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminCmoSpendQuerySchema,
  adminCmoSpendSchema,
} from "@/schemas/soko-bot.schema";
import { cmoSpend } from "@/services/cmo-spend.service";

const DAY_MS = 86_400_000;

// What every CMO bot (Cuso) spent and where: models, search, Exa, images.
const cmoSpendRoute = createRoute({
  method: "get",
  path: "/cmo-spend",
  operationId: "getAdminCmoSpend",
  tags: ["Admin"],
  request: { query: adminCmoSpendQuerySchema },
  responses: {
    200: jsonSuccessResponse(adminCmoSpendSchema, "Spend per CMO bot"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(cmoSpendRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { days } = c.req.valid("query");
    const since = new Date(Date.now() - days * DAY_MS);
    return ok(
      c,
      adminCmoSpendSchema.parse({
        since: since.toISOString(),
        bots: await cmoSpend(since),
      }),
    );
  });
}
