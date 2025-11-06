import { createRoute } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import { forbidden, notFound, unauthorized } from "../../helpers/error";
import { ok, successResponseSchema } from "../../helpers/response";
import { OpenAPIHonoWithAuth } from "../../lib/hono";
import { userIdSchema, userSchema } from "./schemas";

const app = new OpenAPIHonoWithAuth();

const getUserRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: {
    params: userIdSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: successResponseSchema(userSchema),
        },
      },
      description: "Retrieve the user by ID",
    },
    401: {
      description: "Unauthorized",
    },
    403: {
      description: "Forbidden",
    },
    404: {
      description: "Not Found",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

app.openapi(getUserRoute, async (c) => {
  const auth = c.var.auth;

  if (!auth) {
    unauthorized("Authentication required");
  }

  const id = c.req.param("id");

  if (auth.type === "user" && auth.userId !== id) {
    forbidden("You can only access your own user data");
  }

  const user = await userRepository.getUserById(id);
  if (!user) {
    notFound("User not found");
  }

  return ok(c, userSchema.parse(user));
});

export default app;
