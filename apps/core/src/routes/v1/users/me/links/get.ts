import { createRoute } from "@hono/zod-openapi";
import { linkRepository } from "@sokosumi/database/repositories";

import { internalServerError, notFound, unauthorized } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { linksSchema } from "@/schemas/link.schema";

const route = createRoute({
  method: "get",
  path: "/me/links",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(linksSchema, "Retrieve links by current user"),
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

    const links = await linkRepository.getLinksByUserId(user.id);
    if (!links) {
      throw notFound("Links not found");
    }

    try {
      return ok(c, linksSchema.parse(links));
    } catch (error) {
      console.error(error);
      throw internalServerError("Failed to parse job");
    }
  });
}
