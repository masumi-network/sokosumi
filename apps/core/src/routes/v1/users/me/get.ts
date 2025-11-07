import { createRoute } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import { userSchema } from "../schemas";

const route = createRoute({
  method: "get",
  path: "/me",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(userSchema, "Retrieve the current user"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { user } = c.var;

    if (user === null) {
      forbidden("A non-user cannot access their own data");
    }

    const userRecord = await userRepository.getUserById(user.id);
    if (!userRecord) {
      notFound("User not found");
    }

    return ok(c, userSchema.parse(userRecord));
  });
}
