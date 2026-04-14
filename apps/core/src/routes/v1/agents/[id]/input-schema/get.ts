import { createRoute, z } from "@hono/zod-openapi";
import { createAgentClient } from "@sokosumi/masumi";
import { inputSchemaSchema } from "@sokosumi/masumi/schemas";

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
        overrideApiBaseUrl: true,
      },
    });

    if (!agent) {
      throw notFound("Agent not found");
    }

    const inputSchemaResult =
      await createAgentClient().fetchAgentInputSchema(agent);
    if (inputSchemaResult.isErr()) {
      throw unprocessableEntity(inputSchemaResult.error);
    }

    const mockInputSchema = {
      input_data: [
        {
          id: "info",
          type: "none",
          name: "Information",
          data: {
            description:
              "# AI Campaign Generator with Auto-Extraction\n\n    Provide your website URL and basic campaign details.\n    We'll automatically extract your business information for your review.",
          },
          validations: null,
        },
        {
          id: "website",
          type: "text",
          name: "Website URL",
          data: { placeholder: "https://www.yourwebsite.com" },
          validations: null,
        },
        {
          id: "language",
          type: "text",
          name: "Campaign Language",
          data: {
            placeholder: "English, Spanish, French, etc.",
            default: "English",
          },
          validations: null,
        },
        {
          id: "goal",
          type: "textarea",
          name: "Primary Campaign Goal",
          data: {
            placeholder: "e.g., Brand awareness, lead generation, drive sales",
            default: "Generate leads and increase brand awareness",
          },
          validations: null,
        },
        {
          id: "logo",
          type: "file",
          name: "Logo URL (PNG, JPG)",
          data: {
            placeholder: "https://example.com/logo.png",
            outputFormat: "url",
            accept: "image/*",
          },
          validations: null,
        },
      ],
    };

    const inputSchema = mockInputSchema; //inputSchemaSchema.parse(mockInputSchema);
    return ok(c, inputSchema);
  });
}
