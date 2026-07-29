import { createRoute, z } from "@hono/zod-openapi";

import { createAgentJobForUser } from "@/helpers/job";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { createJobRequestSchema, jobSummarySchema } from "@/schemas/job.schema";
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
    description:
      "Create a new job for an agent. Session user or orchestrator with context headers; coworker keys are rejected (assigned coworkers use POST /tasks/{id}/jobs).",
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
      201: jsonSuccessResponse(jobSummarySchema, "Job created successfully"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Agent not found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Owner-only: coworker+context must not mint marketplace jobs that charge
    // another user's credits. Assigned coworkers create jobs via /tasks/{id}/jobs.
    const userContext = requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: agentId } = c.req.valid("param");
    const { maxCredits, inputData, inputSchema, name, projectId } =
      c.req.valid("json");

    const job = await createAgentJobForUser({
      owner: {
        ownerId: userContext.userId,
        organizationId: userContext.organizationId,
        workspaceId: workspaceContext.workspaceId,
      },
      agentInput: {
        agentId,
        inputData,
        inputSchema,
        maxCredits,
        name,
        projectId,
      },
    });

    return created(c, jobSummarySchema.parse(flattenJob(job)));
  });
}
