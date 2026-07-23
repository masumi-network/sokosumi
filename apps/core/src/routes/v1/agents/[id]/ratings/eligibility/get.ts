import { createRoute, z } from "@hono/zod-openapi";
import { jobRepository } from "@sokosumi/database/repositories";

import { requireAvailableAgentOrThrow } from "@/helpers/agent";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { agentRatingEligibilitySchema } from "@/schemas/agent.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/ratings/eligibility",
    description:
      "Check whether the authenticated caller is eligible to rate an agent (has finished at least one job with it)",
    tags: ["Agents"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(
        agentRatingEligibilitySchema,
        "Whether the caller may rate the agent",
      ),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const eligible = await prisma.$transaction(async (tx) => {
      await requireAvailableAgentOrThrow(id, tx);

      return await jobRepository.doesUserHaveFinishedJobWithAgent(
        userContext.userId,
        id,
        tx,
      );
    });

    return ok(c, agentRatingEligibilitySchema.parse({ eligible }));
  });
}
