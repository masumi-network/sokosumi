import { createRoute, z } from "@hono/zod-openapi";
import { jobInclude } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";

import { forbidden, notFound } from "@/helpers/error.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { jobSchema, patchJobRequestSchema } from "@/schemas/job.schema.js";
import { serializeJobDetails } from "@/types/job";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "job_123",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}",
    description:
      "Partially update a job. Only client-editable fields are accepted; omit read-only attributes.",
    tags: ["Jobs"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: patchJobRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(jobSchema, "Job updated"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { name } = c.req.valid("json");

    const job = await prisma.$transaction(async (tx) => {
      const existing = await tx.job.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
        },
      });

      if (!existing) {
        throw notFound("Job not found");
      }

      if (existing.userId !== userContext.userId) {
        throw forbidden("You can only update your own jobs");
      }

      const job = await tx.job.update({
        where: { id },
        data: { name },
        include: jobInclude,
      });

      return serializeJobDetails(mapJobWithStatus(job));
    });

    return ok(c, jobSchema.parse(job));
  });
}
