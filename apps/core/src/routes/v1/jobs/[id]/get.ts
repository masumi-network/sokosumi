import { createRoute, z } from "@hono/zod-openapi";
import { jobRepository } from "@sokosumi/database/repositories";

import { convertCentsToCredits } from "@/helpers/credits.js";
import { forbidden, notFound, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import { jobSchema } from "../schemas.js";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Jobs"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(jobSchema, "Retrieve job by ID"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { user } = c.var;
    const { id } = c.req.valid("param");

    if (!user) {
      throw unauthorized("Unauthorized");
    }

    const job = await jobRepository.getJobById(id);
    if (!job) {
      throw notFound("Job not found");
    }

    if (job.userId !== user.id) {
      throw forbidden("You can only access your own jobs");
    }

    const formattedJob = {
      ...job,
      credits: Math.abs(
        convertCentsToCredits(job.creditTransaction?.amount ?? BigInt(0)),
      ),
      resultHash: job.purchase?.resultHash ?? null,
    };

    return ok(c, jobSchema.parse(formattedJob));
  });
}
