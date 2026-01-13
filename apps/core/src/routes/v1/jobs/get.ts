import { createRoute, z } from "@hono/zod-openapi";

import { getUserJobs } from "@/helpers/job";
import { jsonErrorResponse, jsonPaginatedResponse } from "@/helpers/openapi";
import {
  calculatePaginationMeta,
 okPaginated,  paginationQuerySchema } from "@/helpers/pagination";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { jobsSchema } from "@/schemas/job.schema.js";

const query = z
  .object({
    agentId: z
      .string()
      .optional()
      .openapi({
        param: { name: "agentId", in: "query" },
        description: "Filter jobs by agent ID",
        example: "cmaeygqwa000e8i0s9s7wif8i",
      }),
  })
  .merge(paginationQuerySchema);

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: "List all jobs for the current user",
    tags: ["Jobs"],
    request: {
      query,
    },
    responses: {
      200: jsonPaginatedResponse(
        jobsSchema,
        "Retrieve all jobs with pagination",
      ),
      401: jsonErrorResponse("Unauthorized"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { agentId, page, limit } = c.req.valid("query");

    const { jobs, total } = await getUserJobs(authContext, {
      agentId,
      page,
      limit,
    });

    const pagination = calculatePaginationMeta(page, limit, total);

    return okPaginated(c, jobsSchema.parse(jobs), pagination);
  });
}
