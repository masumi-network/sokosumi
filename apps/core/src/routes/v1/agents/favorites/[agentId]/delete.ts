import { createRoute, z } from "@hono/zod-openapi";

import { removeAgentFromFavorites } from "@/helpers/agent";
import { jsonContent, jsonErrorResponse } from "@/helpers/openapi";
import { ok, successResponseSchema } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { agentFavoriteSchema } from "@/schemas/agent.schema";

const params = z.object({
  agentId: z.string().openapi({
    param: { name: "agentId", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/favorites/{agentId}",
    description: "Remove an agent from the authenticated caller's favorites",
    tags: ["Agents"],
    request: {
      params,
    },
    responses: {
      200: {
        description: "Agent removed from favorites",
        content: jsonContent(successResponseSchema(agentFavoriteSchema)),
      },
      401: jsonErrorResponse("Unauthorized"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { agentId } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      await removeAgentFromFavorites(userContext.userId, agentId, tx);
    });

    return ok(c, agentFavoriteSchema.parse({ agentId }));
  });
}
