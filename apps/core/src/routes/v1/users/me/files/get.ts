import { createRoute, z } from "@hono/zod-openapi";
import { blobRepository } from "@sokosumi/database/repositories";

import { internalServerError, notFound, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { fileSchema } from "@/schemas/files.schema";

const route = createRoute({
  method: "get",
  path: "/me/files",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(
      z.array(fileSchema),
      "Retrieve files by current user",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { user } = c.var;
    console.log("user", user);

    if (!user) {
      throw unauthorized("A non-user cannot access files");
    }

    const files = await blobRepository.getBlobsByUserId(user.id);
    if (!files) {
      throw notFound("Files not found");
    }

    try {
      const parsedFiles = z.array(fileSchema).parse(files);
      return ok(c, parsedFiles);
    } catch (error) {
      console.error(error);
      throw internalServerError("Failed to parse job");
    }
  });
}
