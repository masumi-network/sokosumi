import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { dummyAgents } from "@/lib/dummy-data";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const agentSchema = z
  .object({
    id: z.string().openapi({ example: "agent_123" }),
    name: z.string().openapi({ example: "Research Assistant" }),
  })
  .openapi("Agent");

const agentsSchema = z.array(agentSchema);

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Agents"],
  responses: {
    200: jsonSuccessResponse(agentsSchema, "Retrieve all agents"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    return ok(c, dummyAgents);
  });
}
