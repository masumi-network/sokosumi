import { createRoute, z } from "@hono/zod-openapi";
import { publicShareRepository } from "@sokosumi/database/repositories";

import { forbidden, notFound } from "@/helpers/error.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "job_123",
  }),
});

const deleteJobShareResponseSchema = z.object({});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/share",
    description: "Delete the public share for a job",
    tags: ["Jobs"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        deleteJobShareResponseSchema,
        "Delete a job share",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
        },
      });

      if (!job) {
        throw notFound("Job not found");
      }

      if (job.userId !== authContext.userId) {
        throw forbidden("You can only manage sharing for your own jobs");
      }

      await publicShareRepository.deleteByJobId(id, tx);
    });

    return ok(c, deleteJobShareResponseSchema.parse({}));
  });
}
