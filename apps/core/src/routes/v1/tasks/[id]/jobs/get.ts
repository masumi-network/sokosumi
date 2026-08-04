import { createRoute, z } from "@hono/zod-openapi";
import { jobListSummaryInclude } from "@sokosumi/database/types/job";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { jobSummariesSchema } from "@/schemas/job.schema";
import { flattenJob } from "@/types/job";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/jobs",
  description: "List jobs belonging to a task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(jobSummariesSchema, "Retrieve task jobs"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const jobs = await prisma.$transaction(async (tx) => {
      await requireTaskReadForRouteVars(c.var, id, tx);

      const jobsList = await tx.job.findMany({
        where: { taskId: id },
        include: jobListSummaryInclude,
        orderBy: { createdAt: "asc" },
      });

      return jobsList.map((job) => flattenJob(job));
    });

    return ok(c, jobSummariesSchema.parse(jobs));
  });
}
