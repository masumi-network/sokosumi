import { createRoute, z } from "@hono/zod-openapi";
import { agentRepository } from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import { agentSchema } from "./schemas.js";

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
    const agents = await agentRepository.getAgentsWithRelations();

    if (!agents) {
      throw notFound("No agents found");
    }

    return ok(c, agentsSchema.parse(agents));
  });
}
