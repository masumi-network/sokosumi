import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { organizationRepository } from "@sokosumi/database/repositories";

import { buildOrganizationDesignMdMetadata } from "@/helpers/design-md";
import { serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { uploadDesignMdContent } from "@/lib/design-md-blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  designMdWriteSchema,
  persistedDesignMdSchema,
} from "@/schemas/design-md.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "put",
  path: "/{id}/design-md",
  description:
    "Set or clear an organization's DESIGN.md. Only organization owners and admins may do this. Pass a null `content` to clear it.",
  tags: ["Organizations"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: designMdWriteSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      persistedDesignMdSchema,
      "The persisted DESIGN.md for the organization",
      {
        data: {
          designMd: {
            url: "https://blob.example/design.md",
            extractionId: "12345",
          },
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
    503: jsonErrorResponse("Service Unavailable - DESIGN.md storage failed"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    let url: string | null = null;
    if (body.content !== null) {
      url = await uploadDesignMdContent(body.content, body.extractionId);
      if (!url) {
        throw serviceUnavailable("Failed to store the DESIGN.md");
      }
    }

    const { serialized, persisted } = buildOrganizationDesignMdMetadata(
      organization.metadata,
      { url, extractionId: body.extractionId },
    );

    await organizationRepository.updateOrganizationById(
      organization.id,
      { metadata: serialized },
      prisma,
    );

    return ok(c, persistedDesignMdSchema.parse({ designMd: persisted }));
  });
}
