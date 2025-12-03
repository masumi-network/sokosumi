import { createRoute } from "@hono/zod-openapi";
import { blobRepository } from "@sokosumi/database/repositories";

import { internalServerError, notFound, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { filesSchema } from "@/schemas/file.schema";

const route = createRoute({
  method: "get",
  path: "/me/files",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(filesSchema, "Retrieve files by current user"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { user } = c.var;

    if (!user) {
      throw unauthorized("A non-user cannot access files");
    }

    const files = await blobRepository.getBlobsByUserId(user.id);
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
