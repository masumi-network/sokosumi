import { createRoute, z } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";

import { forbidden } from "@/helpers/error";
import { createAgentJobForUser } from "@/helpers/job";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { createJobRequestSchema, jobSchema } from "@/schemas/job.schema";
import { flattenJob } from "@/types/job";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/jobs",
    description: "Create a new job for an agent",
    tags: ["Agents"],
    request: {
      params,
      body: {
        content: {
          "application/json": {
            schema: createJobRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(jobSchema, "Job created successfully"),
      400: jsonErrorResponse("Bad Request"),
      404: jsonErrorResponse("Agent not found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: agentId } = c.req.valid("param");
    const { maxCredits, inputData, inputSchema, name } = c.req.valid("json");

    if (authContext.orchestratorId) {
      throw forbidden("Only the user is allowed to do this action");
    }

    const job = await prisma.$transaction(
      async (tx) => {
        return await createAgentJobForUser(
          {
            agentId,
            userId: authContext.userId,
            organizationId: authContext.organizationId,
            inputData,
            inputSchema,
            maxCredits,
            name,
          },
          tx,
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return created(c, jobSchema.parse(flattenJob(job)));
  });
}
