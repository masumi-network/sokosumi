import { createRoute, z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";
import { createAgentClient } from "@sokosumi/masumi";
import { inputSchemaSchema } from "@sokosumi/masumi/schemas";

import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/input-schema",
  tags: ["Agents"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      inputSchemaSchema,
      "Retrieve the input schema for an agent",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        blockchainIdentifier: true,
        apiBaseUrl: true,
        overrideApiBaseUrl: true,
      },
    });

    if (!agent) {
      throw notFound("Agent not found");
    }

    const inputSchemaResult =
      await createAgentClient().fetchAgentInputSchema(agent);
    if (!inputSchemaResult.ok) {
      throw unprocessableEntity(inputSchemaResult.error);
    }

    const inputSchema = inputSchemaSchema.parse(inputSchemaResult.data);
    return ok(c, inputSchema);
  });
}
