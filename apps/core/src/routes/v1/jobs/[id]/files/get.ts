import { createRoute, z } from "@hono/zod-openapi";
import { blobRepository } from "@sokosumi/database/repositories";

import { internalServerError, notFound, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { filesSchema } from "@/schemas/file.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/files",
  tags: ["Jobs"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(filesSchema, "Retrieve files by job ID"),
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
      throw unauthorized("A non-user cannot access files");
    }

    const files = await blobRepository.getBlobsByUserIdAndJobId(user.id, id);
    if (!files) {
      throw notFound("Files not found");
    }

    const formattedFiles = files.map((file) => ({
      ...file,
      jobId: file.jobEvent.jobId,
    }));

    try {
      const parsedFiles = filesSchema.parse(formattedFiles);
      return ok(c, parsedFiles);
    } catch (error) {
      console.error(error);
      throw internalServerError("Failed to parse job");
    }
  });
}
