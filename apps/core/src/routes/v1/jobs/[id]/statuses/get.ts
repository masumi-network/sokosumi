import { createRoute, z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";
import { jobRepository } from "@sokosumi/database/repositories";

import { requireJobAccess } from "@/helpers/access-control.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { jobStatusesSchema } from "@/schemas/job.schema.js";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/statuses",
  tags: ["Jobs"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(jobStatusesSchema, "Retrieve statuses for a job", {
      data: [
        {
          id: "status_123",
          createdAt: "2025-01-15T10:30:00.000Z",
          updatedAt: "2025-01-15T10:30:00.000Z",
          status: "INITIATED",
          inputSchema: "input_schema",
          input: {
            id: "input_123",
            statusId: "status_123",
            input: '{"prompt":"How many planets are in the solar system?"}',
            inputHash: "input_hash",
            signature: null,
          },
          result: null,
          blobs: [],
          links: [],
        },
        {
          id: "status_456",
          createdAt: "2025-01-15T10:35:00.000Z",
          updatedAt: "2025-01-15T10:35:00.000Z",
          status: "COMPLETED",
          inputSchema: null,
          input: null,
          result: "# Answer\n\nThere are 8 planets in the solar system.",
          blobs: [],
          links: [],
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
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const statuses = await prisma.$transaction(async (tx) => {
      await requireJobAccess(authContext, id, tx);
      const job = await jobRepository.getJobById(id, tx);
      if (!job) {
        throw notFound("Job not found");
      }

      const transformedStatuses = job.statuses.map((status) => ({
        ...status,
        blobs: status.blobs.map((blob) => ({
          ...blob,
          name: blob.fileName ?? null,
          mimeType: blob.mime ?? null,
          jobId: id,
          size: blob.size ? Number(blob.size) : null,
        })),
        links: status.links.map((link) => ({
          ...link,
          jobId: id,
        })),
      }));
      return transformedStatuses;
    });

    return ok(c, jobStatusesSchema.parse(statuses));
  });
}
