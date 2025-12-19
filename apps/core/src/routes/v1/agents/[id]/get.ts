import { createRoute, z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";
import { convertCreditsToCents } from "@sokosumi/database/helpers";

import { CREDIT } from "@/config/constants";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { getAgentCredits } from "@/helpers/pricing";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { agentSchema } from "@/schemas/agent.schema";
import { getDeveloperFromAgent } from "@/schemas/developer.schema";
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
      const minFeeCents = convertCreditsToCents(CREDIT.MIN_FEE_CREDITS);
      const credits = getAgentCredits(agent, creditCosts, minFeeCents);

      if (credits === null) {
        throw unprocessableEntity("Agent has invalid or unknown pricing");
      }

      return {
        ...agent,
        name: agent.overrideName ?? agent.name,
        description: agent.overrideDescription ?? agent.description,
        developer: getDeveloperFromAgent(agent),
        credits,
      };
    });
    return ok(c, agentSchema.parse(agent));
  });
}
