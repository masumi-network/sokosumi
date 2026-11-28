import { createRoute, z } from "@hono/zod-openapi";
import { jobInclude } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";

import { requireJobCollaboration } from "@/helpers/access-control.js";
import { notFound } from "@/helpers/error";
import { readJobDetailsOnSplitTx } from "@/helpers/job-detail";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { networkUsesSharedSchema } from "@/lib/db/network-scope";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { jobSchema, patchJobRequestSchema } from "@/schemas/job.schema.js";
import { serializeJobDetails } from "@/types/job";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "job_123",
  }),
});

const route = withCoworkerContextHeaderParameters(
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
    const { id } = c.req.valid("param");
    const { name } = c.req.valid("json");
    const { networkScope } = c.var;
    const { networkDb } = networkScope;

    await requireJobCollaboration(c.var.authContext, id, networkScope);

    const job = networkUsesSharedSchema()
      ? await networkDb.job.update({
          where: { id },
          data: { name },
          include: jobInclude,
        })
      : await networkScope.sharedTransactionOnce(async (tx) => {
          const updatedAt = new Date();
          const updated = await tx.$executeRaw`
            UPDATE ${networkScope.networkTable("Job")}
            SET "name" = ${name},
                "updatedAt" = ${updatedAt}
            WHERE "id" = ${id}
          `;
          if (updated === 0) {
            throw notFound("Job not found");
          }
          const updatedJob = await readJobDetailsOnSplitTx(
            tx,
            networkScope,
            id,
          );
          if (!updatedJob) {
            throw notFound("Job not found");
          }
          return updatedJob;
        });

    return ok(c, jobSchema.parse(serializeJobDetails(mapJobWithStatus(job))));
  });
}
