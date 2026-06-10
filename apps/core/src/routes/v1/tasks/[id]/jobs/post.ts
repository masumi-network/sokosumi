import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/utils";

import { requireTaskCollaboration } from "@/helpers/access-control";
import { unprocessableEntity } from "@/helpers/error";
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
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireCoworkerAuthContext(c.var.authContext);

    const { id: taskId } = c.req.valid("param");
    const task = await requireTaskCollaboration(authContext, taskId);

    // The non-delegated coworker path already excludes DRAFT inside
    // requireCoworkerTaskCollaboration, which returns 404 to avoid leaking task
    // existence to an unassigned agent. The delegated/owner path resolves via
    // task ownership, which does not exclude DRAFT; since that caller already
    // knows the task exists, reject DRAFT with an explanatory 422 rather than a
    // 404. The differing status codes are intentional, not an oversight.
    if (task.status === TaskStatus.DRAFT) {
      throw unprocessableEntity("Cannot add a job to a draft task");
    }

    const { agentId, inputData, inputSchema, maxCredits, name } =
      c.req.valid("json");

    const job = await createAgentJobForUser({
      owner: {
        userId: task.userId,
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
