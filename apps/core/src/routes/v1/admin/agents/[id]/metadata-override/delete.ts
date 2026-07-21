import { createRoute } from "@hono/zod-openapi";
import {
  agentExampleOutputInclude,
  agentTagsInclude,
} from "@sokosumi/database";
import {
  adminAgentDetailInclude,
  mapAdminAgentDetail,
} from "@/helpers/admin-agent";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminAgentDetailSchema,
  adminAgentIdParamSchema,
} from "@/schemas/admin-agent.schema";

const route = createRoute({
  method: "delete",
  path: "/{id}/metadata-override",
  operationId: "deleteAdminAgentMetadataOverride",
  description:
    "Delete all Sokosumi metadata overrides for an agent (admin only).",
  tags: ["Admin"],
  request: {
    params: adminAgentIdParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminAgentDetailSchema,
      "Agent detail after metadata override removal (idempotent when already absent)",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!agent) {
      throw notFound("Agent not found");
    }

    await prisma.agentMetadataOverride.deleteMany({
      where: { agentId: id },
    });

    const updatedAgent = await prisma.agent.findUnique({
      where: { id },
      include: {
        ...adminAgentDetailInclude,
        ...agentTagsInclude,
        ...agentExampleOutputInclude,
      },
    });

    if (!updatedAgent) {
      throw notFound("Agent not found");
    }

    return ok(
      c,
      adminAgentDetailSchema.parse(mapAdminAgentDetail(updatedAgent)),
    );
  });
}
