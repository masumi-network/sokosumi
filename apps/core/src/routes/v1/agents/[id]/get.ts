import { createRoute, z } from "@hono/zod-openapi";
import { agentRepository } from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithRequestId } from "@/lib/hono";
import { agentSchema } from "@/schemas/agent.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Agents"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(agentSchema, "Retrieve the agent by ID"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithRequestId) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const agent = await agentRepository.getAgentWithRelationsById(id);
    if (!agent) {
      throw notFound("Agent not found");
    }
    return ok(c, agentSchema.parse(agent));
  });
}
