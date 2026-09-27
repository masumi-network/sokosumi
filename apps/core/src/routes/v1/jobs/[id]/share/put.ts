import { createRoute, z } from "@hono/zod-openapi";
import { TaskVisibility } from "@sokosumi/database";

import { requireJobShareCollaboration } from "@/helpers/access-control.job-share.js";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { putJobShareRequestSchema } from "@/schemas/public-share.schema.js";
import { jobShareSchema } from "@/schemas/share.schema.js";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "job_123",
  }),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/share",
    description: "Create or update the public share for a job",
    tags: ["Jobs"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: putJobShareRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(jobShareSchema, "Create or update a job share"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { allowSearchIndexing } = c.req.valid("json");

    const job = await requireJobShareCollaboration(c.var, id, prisma);

    if (job.taskId) {
      const parentTask = await prisma.task.findUnique({
        where: { id: job.taskId },
        select: { visibility: true },
      });
      if (parentTask?.visibility === TaskVisibility.PRIVATE) {
        throw badRequest("Private tasks cannot be shared publicly");
      }
    }

    const share = await prisma.publicShare.upsert({
      where: { jobId: id },
      create: {
        job: { connect: { id } },
        allowSearchIndexing,
        token: crypto.randomUUID(),
      },
      update: {
        allowSearchIndexing,
      },
      include: { job: true, task: true },
    });

    return ok(c, jobShareSchema.parse(share));
  });
}
