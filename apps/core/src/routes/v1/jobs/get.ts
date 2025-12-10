import { createRoute } from "@hono/zod-openapi";
import { JobType } from "@sokosumi/database";
import { jobRepository } from "@sokosumi/database/repositories";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";

import { convertCentsToCredits } from "@/helpers/credits";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { jobsSchema } from "@/schemas/job.schema.js";

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Jobs"],
  responses: {
    200: jsonSuccessResponse(jobsSchema, "Retrieve all jobs", {
      data: [
        {
          id: "cmi4gmksz000104l8wps8p7fp",
          createdAt: "2025-01-15T10:30:00.000Z",
          updatedAt: "2025-01-15T10:35:00.000Z",
          agentId: "agent_123",
          userId: "user_123",
          organizationId: "organization_123",
          name: "Research Task",
          jobType: JobType.PAID,
          status: SokosumiJobStatus.COMPLETED,
          completedAt: "2025-01-15T10:35:00.000Z",
          credits: 5,
          input: '{"prompt":"How many planets are in the solar system?"}',
          inputHash: "input_hash_123",
          inputSchema: "input_schema_123",
          result: "# Answer\n\nThere are 8 planets in the solar system.",
          resultHash: "result_hash_123",
        },
        {
          id: "cmi4gmksz000104l8wps8p8fp",
          createdAt: "2025-01-15T11:00:00.000Z",
          updatedAt: "2025-01-15T11:05:00.000Z",
          agentId: "agent_456",
          userId: "user_123",
          organizationId: null,
          name: "Analysis Job",
          jobType: JobType.FREE,
          status: SokosumiJobStatus.PROCESSING,
          completedAt: null,
          credits: 0,
          input: '{"query":"Analyze market trends"}',
          inputHash: null,
          inputSchema: null,
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
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const jobs = await jobRepository.getJobs({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    });

    const formattedJobs = jobs.map((job) => ({
      ...job,
      credits: Math.abs(
        convertCentsToCredits(job.creditTransaction?.amount ?? BigInt(0)),
      ),
      resultHash: job.purchase?.resultHash ?? null,
    }));
    return ok(c, jobsSchema.parse(formattedJobs));
  });
}
