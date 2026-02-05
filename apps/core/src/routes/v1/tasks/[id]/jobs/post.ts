import { createRoute, z } from "@hono/zod-openapi";

import { requireOrchestratorTaskAccess } from "@/helpers/access-control";
import { forbidden } from "@/helpers/error";
import { createAgentJobForUser } from "@/helpers/job";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { jobSchema } from "@/schemas/job.schema";
import { createTaskJobRequestSchema } from "@/schemas/task.schema";
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
          schema: createTaskJobRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(jobSchema, "Job added to task"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: taskId } = c.req.valid("param");
    const { agentId, inputData, inputSchema, maxCredits, name } =
      c.req.valid("json");

    if (!authContext.orchestratorId) {
      throw forbidden("Only the orchestrator can create jobs for a task");
    }

    const task = await requireOrchestratorTaskAccess(authContext, taskId);
    const job = await createAgentJobForUser({
      authContext: {
        userId: task.userId,
        organizationId: task.organizationId,
        orchestratorId: null,
      },
      agentInput: {
        agentId,
        inputData,
        inputSchema,
        maxCredits,
        name,
      },
      taskContext: {
        taskId,
      },
    });

    return created(c, jobSchema.parse(flattenJob(job)));
  });
}
