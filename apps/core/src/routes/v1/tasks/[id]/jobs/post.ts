import { createRoute, z } from "@hono/zod-openapi";
import {
  jobWithEvents,
  jobWithPurchase,
  jobWithTransaction,
} from "@sokosumi/database/types/job";

import { requireOrchestratorTaskAccess } from "@/helpers/access-control";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { jobSchema } from "@/schemas/job.schema";
import { addTaskJobRequestSchema } from "@/schemas/task.schema";
import { flattenJob } from "@/types/job";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/jobs",
  description: "Add a job to a task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: addTaskJobRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(jobSchema, "Job added to task"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: taskId } = c.req.valid("param");
    const { jobId } = c.req.valid("json");

    const job = await prisma.$transaction(async (tx) => {
      const task = await requireOrchestratorTaskAccess(authContext, taskId, tx);

      const existingJob = await tx.job.findUnique({
        where: { id: jobId },
      });

      if (!existingJob) {
        throw notFound("Job not found");
      }

      if (existingJob.userId !== task.userId) {
        throw forbidden(
          "You can only add jobs that belong to the task owner to this task",
        );
      }

      const updatedJob = await tx.job.update({
        where: { id: jobId },
        data: { taskId },
        include: {
          ...jobWithEvents,
          ...jobWithTransaction,
          ...jobWithPurchase,
        },
      });

      return flattenJob(updatedJob);
    });

    return created(c, jobSchema.parse(job));
  });
}
