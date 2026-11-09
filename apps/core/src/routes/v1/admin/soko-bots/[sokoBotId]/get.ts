import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminSokoBotDetailSchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { sokoBotUsageTotals } from "@/services/soko-bot-usage.service";
import { botParams, mapDetail, mapError } from "../helpers.js";

const detailRoute = createRoute({
  method: "get",
  path: "/{sokoBotId}",
  operationId: "getAdminSokoBot",
  tags: ["Admin"],
  request: { params: botParams },
  responses: {
    200: jsonSuccessResponse(adminSokoBotDetailSchema, "Soko Bot diagnostics"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(detailRoute, async (c) => {
    try {
      const sokoBotId = c.req.valid("param").sokoBotId;
      const [detail, usage] = await Promise.all([
        sokoBotControlPlane.getForAdmin(sokoBotId),
        sokoBotUsageTotals(sokoBotId),
      ]);
      return ok(
        c,
        adminSokoBotDetailSchema.parse({ ...mapDetail(detail), usage }),
      );
    } catch (error) {
      mapError(error);
    }
  });
}
