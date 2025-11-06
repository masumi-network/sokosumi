import { createRoute } from "@hono/zod-openapi";

import { successResponseSchema } from "@/helpers/response";

import { userIdSchema, userSchema } from "./schemas";

export const getMeRoute = createRoute({
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

export const getUserRoute = createRoute({
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
