import { createRoute, z } from "@hono/zod-openapi";
import { agentRepository } from "@sokosumi/database/repositories";

import { ok, successResponseSchema } from "../helpers/response";
import { OpenAPIHonoWithAuthContext } from "../lib/hono";

const agentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .openapi("Agent");

const route = createRoute({
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
  },
});

const app = new OpenAPIHonoWithAuthContext();

app.openapi(route, async (c) => {
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
