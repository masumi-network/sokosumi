import { createRoute, z } from "@hono/zod-openapi";
import { jobRepository } from "@sokosumi/database/repositories";

import { badRequest, notFound, unauthorized } from "@/helpers/error";
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
    const jobs = await jobRepository.getJobsByUserId(user.id);

    if (!jobs) {
      throw notFound("No jobs found");
    }
    // console.log(jobs);
    try {
      const parsedJobs = jobsSchema.parse(jobs);
      return ok(c, parsedJobs);
    } catch (error) {
      console.error(error);
      throw badRequest("Invalid jobs");
    }
  });
}
