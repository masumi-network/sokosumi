import { createRoute, z } from "@hono/zod-openapi";

import { getUserJobs } from "@/helpers/job";
import { jsonErrorResponse, jsonPaginatedResponse } from "@/helpers/openapi";
import {
  calculatePaginationMeta,
  okPaginated,
  paginationQuerySchema,
} from "@/helpers/pagination";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { jobsSchema } from "@/schemas/job.schema.js";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/jobs",
    description: "List all jobs for a specific agent",
    tags: ["Agents"],
    request: {
      params,
      query: paginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedResponse(
        jobsSchema,
        "Retrieve all jobs for the agent with pagination",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const { page, limit } = c.req.valid("query");

    const { jobs, total } = await getUserJobs(authContext, {
      agentId: id,
      page,
      limit,
    });

    const pagination = calculatePaginationMeta(page, limit, total);

    return okPaginated(c, jobsSchema.parse(jobs), pagination);
  });
}
