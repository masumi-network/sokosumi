import { createRoute, z } from "@hono/zod-openapi";
import { JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";

import { getUserJobs } from "@/helpers/job";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { jobsSchema } from "@/schemas/job.schema.js";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/jobs",
    description: "List all jobs for a specific agent",
    tags: ["Agents"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(jobsSchema, "Retrieve all jobs for the agent", {
        data: [
          {
            id: "cmi4gmksz000104l8wps8p7fp",
            createdAt: "2025-01-15T10:30:00.000Z",
            updatedAt: "2025-01-15T10:35:00.000Z",
            agentId: "cmaeygqwa000e8i0s9s7wif8i",
            userId: "user_123",
            organizationId: "organization_123",
            name: "Research Task",
            jobType: JobType.PAID,
            status: SokosumiJobStatus.COMPLETED,
            completedAt: "2025-01-15T10:35:00.000Z",
            credits: 5,
            result: "# Answer\n\nThere are 8 planets in the solar system.",
            resultHash: "result_hash_123",
          },
          {
            id: "cmi4gmksz000104l8wps8p8fp",
            createdAt: "2025-01-15T11:00:00.000Z",
            updatedAt: "2025-01-15T11:05:00.000Z",
            agentId: "cmaeygqwa000e8i0s9s7wif8i",
            userId: "user_123",
            organizationId: null,
            name: "Analysis Job",
            jobType: JobType.FREE,
            status: SokosumiJobStatus.PROCESSING,
            completedAt: null,
            credits: 0,
            result: null,
            resultHash: null,
          },
        ],
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const jobs = await getUserJobs(authContext, { agentId: id });

    return ok(c, jobsSchema.parse(jobs));
  });
}
