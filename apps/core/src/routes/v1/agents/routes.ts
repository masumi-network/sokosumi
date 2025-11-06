import { createRoute } from "@hono/zod-openapi";

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
    },
    500: {
      description: "Internal Server Error",
    },
  },
});
