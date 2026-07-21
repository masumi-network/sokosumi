import { createRoute } from "@hono/zod-openapi";
import {
  agentExampleOutputInclude,
  agentTagsInclude,
} from "@sokosumi/database";
import {
  adminAgentDetailInclude,
  buildMetadataOverrideScalarUpdate,
  mapAdminAgentDetail,
  resolveTagsByNames,
} from "@/helpers/admin-agent";
import { pruneEmptyMetadataOverride } from "@/helpers/admin-agent-override";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminAgentDetailSchema,
  adminAgentIdParamSchema,
  patchAdminAgentMetadataOverrideBodySchema,
} from "@/schemas/admin-agent.schema";

const route = createRoute({
  method: "patch",
  path: "/{id}/metadata-override",
  operationId: "patchAdminAgentMetadataOverride",
  description:
    "Create or update Sokosumi metadata overrides for an agent (admin only).",
  tags: ["Admin"],
  request: {
    params: adminAgentIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: patchAdminAgentMetadataOverrideBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminAgentDetailSchema,
      "Updated agent detail with metadata override",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!agent) {
      throw notFound("Agent not found");
    }

    const scalarUpdate = buildMetadataOverrideScalarUpdate({
      name: body.name,
      description: body.description,
      apiBaseUrl: body.apiBaseUrl,
      authorName: body.authorName,
      authorImage: body.authorImage,
      authorContactEmail: body.authorContactEmail,
      authorContactOther: body.authorContactOther,
      authorOrganization: body.authorOrganization,
      legalPrivacyPolicy: body.legalPrivacyPolicy,
      legalDpa: body.legalDpa,
      legalTerms: body.legalTerms,
      legalOther: body.legalOther,
      image: body.image,
    });

    await prisma.$transaction(async (tx) => {
      // Clear migrated capability leftovers — not on the admin write surface.
      const capabilityClear = {
        capabilityName: null,
        capabilityVersion: null,
      } as const;

      const override = await tx.agentMetadataOverride.upsert({
        where: { agentId: id },
        create: {
          agentId: id,
          ...Object.fromEntries(
            Object.entries(scalarUpdate).map(([key, value]) => [
              key,
              value === undefined ? null : value,
            ]),
          ),
          ...capabilityClear,
        },
        update: {
          ...scalarUpdate,
          ...capabilityClear,
        },
        include: {
          tags: true,
          exampleOutputs: true,
        },
      });

      if (body.tags !== undefined) {
        const tags = await resolveTagsByNames(tx, body.tags);
        await tx.agentMetadataOverride.update({
          where: { id: override.id },
          data: {
            tags: {
              set: tags.map((tag) => ({ id: tag.id })),
            },
          },
        });
      }

      if (body.exampleOutputs !== undefined) {
        await tx.exampleOutput.deleteMany({
          where: { metadataOverrideId: override.id },
        });

        if (body.exampleOutputs.length > 0) {
          await tx.exampleOutput.createMany({
            data: body.exampleOutputs.map((example) => ({
              metadataOverrideId: override.id,
              name: example.name,
              mimeType: example.mimeType,
              url: example.url,
            })),
          });
        }
      }

      await pruneEmptyMetadataOverride(tx, override.id);
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
