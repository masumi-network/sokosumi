import { createRoute, z } from "@hono/zod-openapi";
import { createAgentClient } from "@sokosumi/masumi";
import { inputSchemaSchema } from "@sokosumi/masumi/schemas";
import { toMasumiAgent } from "@/helpers/agent";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/input-schema",
    description: "Get input schema for an agent",
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
  }),
);

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
        metadataOverride: {
          select: {
            apiBaseUrl: true,
          },
        },
      },
    });

    if (!agent) {
      throw notFound("Agent not found");
    }

    const inputSchemaResult = await createAgentClient().fetchAgentInputSchema(
      toMasumiAgent(agent),
    );
    if (inputSchemaResult.isErr()) {
      throw unprocessableEntity(inputSchemaResult.error);
    }

    const inputSchema = inputSchemaSchema.parse(inputSchemaResult.value);
    return ok(c, inputSchema);
  });
}
