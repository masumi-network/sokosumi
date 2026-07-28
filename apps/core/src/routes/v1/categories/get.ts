import { createRoute, z } from "@hono/zod-openapi";

import {
  buildAvailableAgentWhereClause,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { categorySchema, mapCategoryForApi } from "@/schemas/category.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List persisted categories that have at least one available agent. Useful for building filter UIs.",
    tags: ["Categories"],
    responses: {
      200: jsonSuccessResponse(
        z.array(categorySchema),
        "Retrieve persisted categories with available agents",
      ),
      401: jsonErrorResponse("Unauthorized"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const categories = await prisma.$transaction(async (tx) => {
      const creditCosts = await getCreditCostsOrThrow(tx);
      const cardanoV2ReadySources = await getCardanoV2ReadySources(tx);
      const agentWhere = buildAvailableAgentWhereClause(
        creditCosts,
        cardanoV2ReadySources,
      );

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
