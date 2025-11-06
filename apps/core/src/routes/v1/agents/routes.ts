import { createRoute } from "@hono/zod-openapi";

import { errorResponseSchema } from "@/helpers/error";
import { successResponseSchema } from "@/helpers/response";

import { agentsSchema } from "./schemas";

export const getAgentsRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: successResponseSchema(agentsSchema),
        },
      },
      description: "Retrieve all agents",
    },
    401: {
      description: "Unauthorized",
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
