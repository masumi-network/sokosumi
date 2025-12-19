import { createRoute } from "@hono/zod-openapi";
import { AgentStatus } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { transformAgentWithCredits } from "@/helpers/pricing";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { agentsSchema } from "@/schemas/agent.schema";
import { agentOrderBy, agentPricingInclude } from "@/types/agent";

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Agents"],
  responses: {
    200: jsonSuccessResponse(agentsSchema, "Retrieve all agents"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const agents = await prisma.$transaction(async (tx) => {
      const agents = await tx.agent.findMany({
        include: { ...agentPricingInclude },
        orderBy: [...agentOrderBy],
        where: {
          status: AgentStatus.ONLINE,
          isShown: true,
        },
      });

      const creditCosts = await tx.creditCost.findMany();
      if (!creditCosts) {
        throw internalServerError("Failed to get credits for agents");
      }

      return agents
        .map((agent) => {
          return transformAgentWithCredits(agent, creditCosts);
        })
        .filter((agent) => agent !== null);
    });
    return ok(c, agentsSchema.parse(agents));
  });
}
