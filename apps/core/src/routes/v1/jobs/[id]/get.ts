import { createRoute, z } from "@hono/zod-openapi";
import { JobType, jobInclude, OnChainJobStatus } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import { SokosumiJobStatus } from "@sokosumi/utils";

import { requireJobReadForRouteVars } from "@/helpers/access-control.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { jobSchema } from "@/schemas/job.schema.js";
import { serializeJobDetails } from "@/types/job";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}",
    description: "Get job details by ID",
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
          projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          taskId: "task_123",
          name: "Research Task",
          jobType: JobType.PAID,
          status: SokosumiJobStatus.COMPLETED,
          completedAt: "2025-01-15T10:35:00.000Z",
          credits: 5,
          jobStatusSettled: true,
          onChainStatus: OnChainJobStatus.RESULT_SUBMITTED,
          onChainTransactionHash: "0x123abc",
          result: "# Answer\n\nThere are 8 planets in the solar system.",
          resultHash: "result_hash_123",
          input: '{"prompt":"How many planets are in the solar system?"}',
          inputHash: "input_hash_123",
          inputSchema: "input_schema_123",
          agentJobId: "agent_job_123",
          identifierFromPurchaser: "identifier_123",
          user: {
            id: "user_123",
            name: "Ada Lovelace",
            image: null,
          },
          organization: {
            id: "organization_123",
            name: "Acme Labs",
            slug: "acme-labs",
          },
          agent: {
            id: "agent_123",
            name: "Research Agent",
            overrideName: null,
            icon: null,
            image: null,
            overrideImage: null,
            legalPrivacyPolicy: null,
            overrideLegalPrivacyPolicy: null,
            legalTerms: null,
            overrideLegalTerms: null,
            legalDpa: null,
            overrideLegalDpa: null,
            legalOther: null,
            overrideLegalOther: null,
          },
          events: [],
          share: null,
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
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");

    const job = await prisma.$transaction(async (tx) => {
      // Authorize the read (workspace scope for users; assigned-task scope for
      // delegated coworkers) before loading full details.
      await requireJobReadForRouteVars(c.var, id, tx);
      const job = await tx.job.findFirst({
        where: {
          id,
          workspaceId: workspaceContext.workspaceId,
        },
        include: jobInclude,
      });
      if (!job) {
        throw notFound("Job not found");
      }
      return serializeJobDetails(mapJobWithStatus(job));
    });

    return ok(c, jobSchema.parse(job));
  });
}
