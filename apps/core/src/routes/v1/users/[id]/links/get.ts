import { createRoute, z } from "@hono/zod-openapi";
import { linkRepository } from "@sokosumi/database/repositories";

import {
  forbidden,
  internalServerError,
  notFound,
  unauthorized,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { linksSchema } from "@/schemas/link.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/links",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(linksSchema, "Retrieve links by user ID"),
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

    if (user && user.id !== id) {
      throw forbidden("You can only access your own files");
    }

    const links = await linkRepository.getLinksByUserId(id);
    if (!links) {
      throw notFound("Links not found");
    }

    try {
      return ok(c, linksSchema.parse(links));
    } catch (error) {
      console.error(error);
      throw internalServerError("Failed to parse links");
    }
  });
}
