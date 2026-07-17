import { createRoute, z } from "@hono/zod-openapi";

import { requireCoworkerTaskCollaboration } from "@/helpers/access-control";
import { createAgentJobForUser } from "@/helpers/job";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";
import { jobSummarySchema } from "@/schemas/job.schema";
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
    201: jsonSuccessResponse(jobSummarySchema, "Job added to task"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireCoworkerAuthContext(c.var.authContext);

    const { id: taskId } = c.req.valid("param");
    // Assigned-agent-only collaboration: this endpoint is coworker-scoped and
    // intentionally does NOT honor delegation. Delegated/user job creation goes
    // through the user-context routes (agents/{id}/jobs, projects/{id}/jobs).
    // See SOK-554: per-coworker delegation authz before broadening this.
    const task = await requireCoworkerTaskCollaboration(authContext, taskId);

    const { agentId, inputData, inputSchema, maxCredits, name } =
      c.req.valid("json");

    const job = await createAgentJobForUser({
      owner: {
        ownerId: task.ownerId,
        organizationId: task.organizationId,
        workspaceId: task.workspaceId,
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

    return created(c, jobSummarySchema.parse(flattenJob(job)));
  });
}
