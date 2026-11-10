import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { AgentGrantContext } from "@/routes/image-studio-agent/authorize";
import {
  MAX_STUDIO_PRODUCTS,
  studioProductIdentitySchema,
} from "@/schemas/studio-product.schema";
import { readStudioProductCatalog } from "@/services/studio-product-catalog.service";

const agentProductSchema = studioProductIdentitySchema
  .extend({ hasPhoto: z.boolean() })
  .openapi("StudioAgentProduct");

const route = createRoute({
  method: "get",
  path: "/products",
  tags: ["Image studio agent"],
  operationId: "listStudioAgentProducts",
  responses: {
    200: jsonSuccessResponse(
      z.object({
        products: z.array(agentProductSchema).max(MAX_STUDIO_PRODUCTS),
      }),
      "Saved products in the authorized project",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

export default function mount(
  app: OpenAPIHono<{ Variables: { agentGrant: AgentGrantContext } }>,
) {
  app.openapi(route, async (c) => {
    const catalog = await readStudioProductCatalog(c.var.agentGrant.projectId);
    return ok(c, {
      products: catalog.products.map(({ id, name, photo, imageUrl }) => ({
        id,
        name,
        hasPhoto: Boolean(photo || imageUrl),
      })),
    });
  });
}
