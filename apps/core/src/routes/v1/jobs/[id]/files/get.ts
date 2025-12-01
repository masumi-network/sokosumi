import { createRoute, z } from "@hono/zod-openapi";
import { blobRepository } from "@sokosumi/database/repositories";

import { internalServerError, notFound, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import { fileSchema } from "./schema.js";

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
    200: jsonSuccessResponse(z.array(fileSchema), "Retrieve files by job ID"),
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

    const files = await blobRepository.getBlobsByJobId(user.id, id);
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
