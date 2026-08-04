import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import {
  buildAvailableAgentWhereClause,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import { jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
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
    const categories = await prisma.$transaction(async (tx) => {
      const creditCosts = await getCreditCostsOrThrow(tx);
      const agentWhere = buildAvailableAgentWhereClause(creditCosts);

      return tx.category.findMany({
        where: {
          agents: { some: agentWhere },
        },
        orderBy: [{ priority: "asc" }, { name: "asc" }],
      });
    });

    return ok(
      c,
      z.array(categorySchema).parse(categories.map(mapCategoryForApi)),
    );
  });
}
