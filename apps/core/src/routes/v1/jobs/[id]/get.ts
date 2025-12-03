import { createRoute, z } from "@hono/zod-openapi";
import { JobType } from "@sokosumi/database";
import { jobRepository } from "@sokosumi/database/repositories";
import { JobStatus } from "@sokosumi/database/types/job";

import { convertCentsToCredits } from "@/helpers/credits.js";
import { forbidden, notFound, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { jobSchema } from "@/schemas/job.schema.js";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Jobs"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(jobSchema, "Retrieve job by ID", {
      data: {
        id: "cmi4gmksz000104l8wps8p7fp",
        createdAt: "2025-01-15T10:30:00.000Z",
        updatedAt: "2025-01-15T10:35:00.000Z",
        agentId: "agent_123",
        userId: "user_123",
        organizationId: "organization_123",
        name: "Research Task",
        jobType: JobType.PAID,
        status: JobStatus.COMPLETED,
        completedAt: "2025-01-15T10:35:00.000Z",
        credits: 5,
        input: '{"prompt":"How many planets are in the solar system?"}',
        inputHash: "input_hash_123",
        inputSchema: "input_schema_123",
        result: "# Answer\n\nThere are 8 planets in the solar system.",
        resultHash: "result_hash_123",
      },
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
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { user } = c.var;
    const { id } = c.req.valid("param");

    if (!user) {
      throw unauthorized("Unauthorized");
    }

    const job = await jobRepository.getJobById(id);
    if (!job) {
      throw notFound("Job not found");
    }

    if (job.userId !== user.id) {
      throw forbidden("You can only access your own jobs");
    }

    const formattedJob = {
      ...job,
      credits: Math.abs(
        convertCentsToCredits(job.creditTransaction?.amount ?? BigInt(0)),
      ),
      resultHash: job.purchase?.resultHash ?? null,
    };

    return ok(c, jobSchema.parse(formattedJob));
  });
}
