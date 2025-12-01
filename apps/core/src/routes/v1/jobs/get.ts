import { createRoute, z } from "@hono/zod-openapi";
import { jobRepository } from "@sokosumi/database/repositories";

import { convertCentsToCredits } from "@/helpers/credits.js";
import { internalServerError, notFound, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import { jobSchema } from "./schemas.js";

const jobsSchema = z.array(jobSchema);

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Jobs"],
  responses: {
    200: jsonSuccessResponse(jobsSchema, "Retrieve all jobs"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { user } = c.var;
    if (!user) {
      throw unauthorized("Unauthorized");
    }
    const jobs = await jobRepository.getJobs({
      userId: user.id,
      organizationId: user.organizationId,
    });

    if (!jobs) {
      throw notFound("No jobs found");
    }
    const formattedJobs = jobs.map((job) => ({
      ...job,
      credits: Math.abs(
        convertCentsToCredits(job.creditTransaction?.amount ?? BigInt(0)),
      ),
      resultHash: job.purchase?.resultHash ?? null,
    }));
    try {
      const parsedJobs = jobsSchema.parse(formattedJobs);
      return ok(c, parsedJobs);
    } catch (error) {
      console.error(error);
      throw internalServerError("Failed to parse jobs");
    }
  });
}
