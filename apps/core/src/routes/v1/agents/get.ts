import { createRoute } from "@hono/zod-openapi";
import { AgentStatus } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import { convertCreditsToCents } from "@sokosumi/database/helpers";

import { CREDIT } from "@/config/constants";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { getAgentCredits } from "@/helpers/pricing";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { agentsSchema } from "@/schemas/agent.schema";
import { getDeveloperFromAgent } from "@/schemas/developer.schema";
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
      const minFeeCents = convertCreditsToCents(CREDIT.MIN_FEE_CREDITS);

      return agents
        .map((agent) => {
          const credits = getAgentCredits(agent, creditCosts, minFeeCents);
          if (credits === null) {
            return null;
          }
          return {
            ...agent,
            name: agent.overrideName ?? agent.name,
            description: agent.overrideDescription ?? agent.description,
            developer: getDeveloperFromAgent(agent),
            credits,
          };
        })
        .filter((agent) => agent !== null);
    });
    return ok(c, agentsSchema.parse(agents));
  });
}
