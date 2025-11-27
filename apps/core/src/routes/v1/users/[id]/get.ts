import { createRoute, z } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import { userSchema } from "../schemas.js";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(userSchema, "Retrieve the user by ID"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { user } = c.var;
    const { id } = c.req.valid("param");

    if (user && user.id !== id) {
      throw forbidden("You can only access your own user data");
    }

    const userRecord = await userRepository.getUserById(id);
    if (!userRecord) {
      throw notFound("User not found");
    }

    return ok(c, userSchema.parse(userRecord));
  });
}
