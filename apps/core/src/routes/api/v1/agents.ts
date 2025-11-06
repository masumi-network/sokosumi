import { createRoute, z } from "@hono/zod-openapi";
import { agentRepository } from "@sokosumi/database/repositories";

import { ok, successResponseSchema } from "../../../helpers/response";
import { OpenAPIHonoWithAuth } from "../../../lib/hono";

const app = new OpenAPIHonoWithAuth();

const agentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .openapi("Agent");

const getAgentsRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: successResponseSchema(z.array(agentSchema)),
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

app.openapi(getAgentsRoute, async (c) => {
  const agents = await agentRepository.getAgentsWithRelations();
  return ok(
    c,
    agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
    })),
  );
});

export default app;
