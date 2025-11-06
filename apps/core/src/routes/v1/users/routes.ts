import { createRoute } from "@hono/zod-openapi";

import { errorResponseSchema } from "@/helpers/error";
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
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Not Found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
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
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Not Found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});
