import { createRoute, z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";

import {
  calculateAgentRating,
  calculateAverageExecutionTime,
  canUserAccessAgent,
  getAgentAccessContext,
  validateAgentCredits,
} from "@/helpers/agent";
import { notFound, unauthorized, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { agentSchema } from "@/schemas/agent.schema";
import {
  agentJobsCountInclude,
  agentOrganizationsInclude,
  agentPricingInclude,
} from "@/types/agent";

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
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const agent = await prisma.$transaction(async (tx) => {
      const { userOrganizationIds, creditCosts } = await getAgentAccessContext(
        authContext,
        tx,
      );
      const agent = await tx.agent.findUnique({
        where: { id },
        include: {
          ...agentPricingInclude,
          ...agentOrganizationsInclude,
          ...agentJobsCountInclude,
        },
      });
      if (!agent) {
        throw notFound("Agent not found");
      }

      if (
        !canUserAccessAgent(
          agent,
          userOrganizationIds,
          authContext.organizationId,
        )
      ) {
        throw unauthorized("You are not authorized to access this agent");
      }

      const agentWithCredits = await validateAgentCredits(agent, creditCosts);
      if (!agentWithCredits) {
        throw unprocessableEntity("Agent has invalid or unknown pricing");
      }

      const averageExecutionTime = await calculateAverageExecutionTime(id, tx);
      const executionMetrics = {
        count: agent._count.jobs,
        averageTime: averageExecutionTime ?? null,
      };

      const ratingMetrics = await calculateAgentRating(id, tx);

      return {
        ...agentWithCredits,
        metrics: {
          executions: executionMetrics,
          ratings: ratingMetrics,
        },
      };
    });
    return ok(c, agentSchema.parse(agent));
  });
}
