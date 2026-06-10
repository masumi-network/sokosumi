import { createRoute, z } from "@hono/zod-openapi";

import { createDemoJobForUser } from "@/helpers/job";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { createDemoJobRequestSchema, jobSchema } from "@/schemas/job.schema";
import { serializeJobDetails } from "@/types/job";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/demo-jobs",
    description:
      "Create a demo job for an agent from a pre-computed demo result, and enqueue any file/link sources found in the result.",
    tags: ["Agents"],
    request: {
      params,
      body: {
        content: {
          "application/json": {
            schema: createDemoJobRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(jobSchema, "Demo job created successfully"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Agent not found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: agentId } = c.req.valid("param");
    const request = c.req.valid("json");

    const job = await createDemoJobForUser({
      owner: {
        userId: userContext.userId,
        organizationId: userContext.organizationId,
        workspaceId: workspaceContext.workspaceId,
      },
      agentId,
      request,
    });

    return created(c, jobSchema.parse(serializeJobDetails(job)));
  });
}
