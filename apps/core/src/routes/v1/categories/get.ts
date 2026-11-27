import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { listCategoriesInUse } from "@/lib/agent-catalog/categories";
import { publicRequestNetworkScope } from "@/middleware/network-scope";
import { categorySchema, mapCategoryForApi } from "@/schemas/category.schema";

const route = createRoute({
  method: "get",
  path: "/",
  description:
    "List persisted categories that have at least one available agent. Useful for building filter UIs.",
  tags: ["Categories"],
  security: [],
  responses: {
    200: jsonSuccessResponse(
      z.array(categorySchema),
      "Retrieve persisted categories with available agents",
    ),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const scope = await publicRequestNetworkScope(c);
    const categories = await listCategoriesInUse(scope);

    return ok(
      c,
      z.array(categorySchema).parse(categories.map(mapCategoryForApi)),
    );
  });
}
