import { createRoute, z } from "@hono/zod-openapi";
import { JobType } from "@sokosumi/database";
import {
  jobWithEvents,
  jobWithPurchase,
  jobWithTransaction,
  SokosumiJobStatus,
} from "@sokosumi/database/types/job";

import { requireScopedJobReadAccess } from "@/helpers/access-control.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { jobScopeQuerySchema } from "@/helpers/scope";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { jobSchema } from "@/schemas/job.schema.js";
import { flattenJob } from "@/types/job";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const query = z.object({
  scope: jobScopeQuerySchema,
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}",
    description: "Get job details by ID",
    tags: ["Jobs"],
    request: {
      params,
      query,
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
          status: SokosumiJobStatus.COMPLETED,
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
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { scope } = c.req.valid("query");

    const job = await prisma.$transaction(async (tx) => {
      await requireScopedJobReadAccess(authContext, id, scope, tx);
      const job = await tx.job.findUnique({
        where: { id },
        include: {
          ...jobWithEvents,
          ...jobWithTransaction,
          ...jobWithPurchase,
        },
      });
      if (!job) {
        throw notFound("Job not found");
      }
      return flattenJob(job);
    });

    return ok(c, jobSchema.parse(job));
  });
}
