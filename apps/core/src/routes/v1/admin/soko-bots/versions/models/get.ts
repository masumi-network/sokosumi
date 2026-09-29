import { createRoute } from "@hono/zod-openapi";
import { listGatewayModels } from "@/clients/ai-gateway.client";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { sokoBotGatewayModelListSchema } from "@/schemas/soko-bot.schema";

const modelsRoute = createRoute({
  method: "get",
  path: "/versions/models",
  operationId: "listAdminSokoBotGatewayModels",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotGatewayModelListSchema,
      "Models available on the AI Gateway",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(modelsRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const models = await listGatewayModels();
    return ok(c, sokoBotGatewayModelListSchema.parse({ models }));
  });
}
