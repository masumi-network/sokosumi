import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { sokoBotIntegrationCatalogEntrySchema } from "@/schemas/soko-bot.schema";
import { searchSokoBotIntegrationCatalog } from "@/services/soko-bot-integrations.service";
import { mapIntegrationError } from "../../helpers.js";

const integrationCatalogRoute = createRoute({
  method: "get",
  path: "/integrations/catalog",
  operationId: "searchSokoBotIntegrationCatalog",
  tags: ["Soko Bots"],
  request: {
    query: z.object({
      query: z.string().max(100).optional(),
    }),
  },
  responses: {
    200: jsonSuccessResponse(
      z.array(sokoBotIntegrationCatalogEntrySchema),
      "Composio toolkits matching the search",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(integrationCatalogRoute, async (c) => {
    requireUserAuthContext(c.var.authContext);
    try {
      const entries = await searchSokoBotIntegrationCatalog(
        c.req.valid("query").query ?? "",
      );
      return ok(
        c,
        z.array(sokoBotIntegrationCatalogEntrySchema).parse(entries),
      );
    } catch (error) {
      mapIntegrationError(error);
    }
  });
}
