import { createRoute } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import { forbidden, notFound, unauthorized } from "../../../../helpers/error";
import { ok, successResponseSchema } from "../../../../helpers/response";
import { OpenAPIHonoWithAuth } from "../../../../lib/hono";
import type { UserAuthContext } from "../../../../middleware/auth";
import { userSchema } from "./schemas";

const app = new OpenAPIHonoWithAuth();

const getMeRoute = createRoute({
  method: "get",
  path: "/me",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: successResponseSchema(userSchema),
        },
      },
      description: "Retrieve the current user",
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

app.openapi(getMeRoute, async (c) => {
  const auth = c.var.auth;

  if (!auth) {
    unauthorized("Authentication required");
  }

  if (auth.type !== "user") {
    forbidden("Internal tokens cannot access user data");
  }

  const userAuth = auth as UserAuthContext;
  const user = await userRepository.getUserById(userAuth.userId);
  if (!user) {
    notFound("User not found");
  }

  return ok(c, userSchema.parse(user));
});

export default app;
