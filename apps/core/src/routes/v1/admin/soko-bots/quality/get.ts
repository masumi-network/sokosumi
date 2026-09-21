import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminSokoBotQualitySchema } from "@/schemas/soko-bot.schema";
import { getSokoBotQualityOverview } from "@/services/soko-bot-quality.service";

const qualityRoute = createRoute({
  method: "get",
  path: "/quality",
  operationId: "getAdminSokoBotQuality",
  tags: ["Admin"],
  request: {
    query: z.object({
      versionId: z.string().trim().min(1).max(64).optional(),
      sokoBotId: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: jsonSuccessResponse(
      adminSokoBotQualitySchema,
      "Judge scores over time and per agent version",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(qualityRoute, async (c) => {
    return ok(
      c,
      adminSokoBotQualitySchema.parse(
        await getSokoBotQualityOverview(c.req.valid("query")),
      ),
    );
  });
}
