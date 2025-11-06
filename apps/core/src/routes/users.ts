import { createRoute, z } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import { forbidden, notFound, unauthorized } from "../helpers/error";
import { ok, successResponseSchema } from "../helpers/response";
import { OpenAPIHonoWithAuth } from "../lib/hono";
import type { UserAuthContext } from "../middleware/auth";

const app = new OpenAPIHonoWithAuth();

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

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

  // Check if the user is authenticated
  if (auth.type !== "user") {
    forbidden("Internal tokens cannot access user data");
  }

  // TypeScript control flow doesn't always recognize thrown errors
  // Safe to assert as UserAuthContext after the check above
  const userAuth = auth as UserAuthContext;
  const user = await userRepository.getUserById(userAuth.userId);
  if (!user) {
    notFound("User not found");
  }

  return ok(c, { user: userSchema.parse(user) });
});

const getUserRoute = createRoute({
  method: "get",
  path: "/:id",
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

app.openapi(getUserRoute, async (c) => {
  const auth = c.var.auth;

  if (!auth) {
    unauthorized("Authentication required");
  }

  const id = c.req.param("id");

  // Authorization: users can only access their own ID
  // Internal service token has full access
  if (auth.type === "user" && auth.userId !== id) {
    forbidden("You can only access your own user data");
  }

  const user = await userRepository.getUserById(id);
  if (!user) {
    notFound("User not found");
  }

  return ok(c, { user: userSchema.parse(user) });
});

export default app;
