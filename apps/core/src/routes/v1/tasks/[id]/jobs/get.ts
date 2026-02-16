import { createRoute, z } from "@hono/zod-openapi";
import {
  jobWithEvents,
  jobWithPurchase,
  jobWithTransaction,
} from "@sokosumi/database/types/job";

import { requireScopedTaskReadAccess } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { taskScopeQuerySchema } from "@/helpers/scope";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { jobsSchema } from "@/schemas/job.schema";
import { flattenJob } from "@/types/job";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const querySchema = z.object({
  scope: taskScopeQuerySchema,
});

const route = createRoute({
  method: "get",
  path: "/{id}/jobs",
  description: "List jobs belonging to a task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(jobsSchema, "Retrieve task jobs"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const { scope } = c.req.valid("query");

    const jobs = await prisma.$transaction(async (tx) => {
      await requireScopedTaskReadAccess(authContext, id, scope, tx);

      const jobsList = await tx.job.findMany({
        where: { taskId: id },
        include: {
          ...jobWithEvents,
          ...jobWithTransaction,
          ...jobWithPurchase,
        },
        orderBy: { createdAt: "asc" },
      });

      return jobsList.map((job) => flattenJob(job));
    });

    return ok(c, jobsSchema.parse(jobs));
  });
}
