import { createRoute, z } from "@hono/zod-openapi";
import { JobType } from "@sokosumi/database";
import {
  jobWithCreditTransaction,
  jobWithEvents,
  jobWithPurchase,
  SokosumiJobStatus,
} from "@sokosumi/database/types/job";

import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createCursorPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { jobsSchema } from "@/schemas/job.schema.js";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { flattenJob } from "@/types/job";

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
  .extend(cursorPaginationQuerySchema.shape);

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: "List all jobs for the current user (paginated)",
    tags: ["Jobs"],
    request: {
      query,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(jobsSchema, "Retrieve all jobs", {
        data: [
          {
            id: "cmi4gmksz000104l8wps8p7fp",
            createdAt: "2025-01-15T10:30:00.000Z",
            updatedAt: "2025-01-15T10:35:00.000Z",
            agentId: "agent_123",
            userId: "user_123",
            organizationId: "organization_123",
            name: "Research Task",
            jobType: JobType.PAID,
            status: SokosumiJobStatus.COMPLETED,
            completedAt: "2025-01-15T10:35:00.000Z",
            credits: 5,
            result: "# Answer\n\nThere are 8 planets in the solar system.",
            resultHash: "result_hash_123",
          },
          {
            id: "cmi4gmksz000104l8wps8p8fp",
            createdAt: "2025-01-15T11:00:00.000Z",
            updatedAt: "2025-01-15T11:05:00.000Z",
            agentId: "agent_456",
            userId: "user_123",
            organizationId: null,
            name: "Analysis Job",
            jobType: JobType.FREE,
            status: SokosumiJobStatus.PROCESSING,
            completedAt: null,
            credits: 0,
            result: null,
            resultHash: null,
          },
        ],
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
          pagination: {
            cursor: null,
            limit: 20,
            hasNext: true,
            nextCursor: "cmi4gmksz000104l8wps8p8fp",
          },
        },
      }),
      401: jsonErrorResponse("Unauthorized"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const queryParams = c.req.valid("query");
    const { agentId } = queryParams;
    const { cursor, limit, skip } = parseCursorPagination(queryParams);

    const where = {
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      ...(agentId ? { agentId } : {}),
    };

    const jobs = await prisma.job.findMany({
      where,
      take: limit + 1, // Fetch one extra to check hasNext
      skip: skip ? 1 : undefined,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: "asc" },
      include: {
        ...jobWithEvents,
        ...jobWithCreditTransaction,
        ...jobWithPurchase,
      },
    });

    const flattenedJobs = jobs.map(flattenJob);
    const paginationMeta = createCursorPaginationMeta(
      flattenedJobs,
      limit,
      cursor,
      "id",
    );

    return ok(
      c,
      jobsSchema.parse(flattenedJobs.slice(0, limit)),
      paginationMeta,
    );
  });
}
