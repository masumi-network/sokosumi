import { createRoute, z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";

import { transformAgentWithCredits } from "@/helpers/agent";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { agentSchema } from "@/schemas/agent.schema";
import { agentPricingInclude } from "@/types/agent";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Agents"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(agentSchema, "Retrieve the agent by ID"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const agent = await prisma.$transaction(async (tx) => {
      const agent = await tx.agent.findUnique({
        where: { id },
        include: { ...agentPricingInclude },
      });
      if (!agent) {
        throw notFound("Agent not found");
      }

      const creditCosts = await tx.creditCost.findMany();
      const transformed = transformAgentWithCredits(agent, creditCosts);
      if (!transformed) {
        throw unprocessableEntity("Agent has invalid or unknown pricing");
      }

      return transformed;
    });
    return ok(c, agentSchema.parse(agent));
  });
}
