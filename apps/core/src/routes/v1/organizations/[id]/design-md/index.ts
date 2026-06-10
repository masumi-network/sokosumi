import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { organizationRepository } from "@sokosumi/database/repositories";

import {
  buildOrganizationDesignMdMetadataUpdate,
  readOrganizationDesignMdMetadata,
} from "@/helpers/design-md-metadata";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { empty, ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  designMdMetadataSchema,
  designMdUpdateRequestSchema,
} from "@/schemas/design-md.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}/design-md",
  description: "Read DESIGN.md metadata stored on the organization profile.",
  tags: ["Organizations"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      designMdMetadataSchema,
      "Retrieve organization DESIGN.md metadata",
      {
        data: {
          extractionId: "42",
          previewUrl: "https://www.masumi.network/tools/design-md?cached=42",
          url: "https://blob.example/design-md/file.md",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/{id}/design-md",
  description:
    "Update DESIGN.md metadata on the organization profile (owner/admin only).",
  tags: ["Organizations"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: designMdUpdateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      designMdMetadataSchema,
      "Updated organization DESIGN.md metadata",
      {
        data: {
          extractionId: null,
          previewUrl: null,
          url: "https://blob.example/design-md/file.md",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}/design-md",
  description:
    "Remove DESIGN.md metadata from the organization profile (owner/admin only).",
  tags: ["Organizations"],
  request: { params },
  responses: {
    204: {
      description: "DESIGN.md metadata removed",
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getRoute, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const metadata = await prisma.$transaction(async (tx) => {
      const { organization } = await resolveMemberOrganizationById({
        id,
        userId: userContext.userId,
        tx,
      });

      return readOrganizationDesignMdMetadata(organization.metadata);
    });

    return ok(c, designMdMetadataSchema.parse(metadata));
  });

  app.openapi(patchRoute, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const metadata = await prisma.$transaction(async (tx) => {
      await resolveMemberOrganizationById({
        id,
        userId: userContext.userId,
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
        tx,
      });

      const organization =
        await organizationRepository.getOrganizationWithRelationsById(id, tx);
      if (!organization) {
        return null;
      }

      const serializedMetadata = buildOrganizationDesignMdMetadataUpdate(
        organization.metadata,
        {
          extractionId: body.extractionId,
          url: body.url,
        },
      );

      await organizationRepository.updateOrganizationById(
        id,
        { metadata: serializedMetadata },
        tx,
      );

      return readOrganizationDesignMdMetadata(serializedMetadata);
    });

    return ok(c, designMdMetadataSchema.parse(metadata));
  });

  app.openapi(deleteRoute, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      await resolveMemberOrganizationById({
        id,
        userId: userContext.userId,
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
        tx,
      });

      const organization =
        await organizationRepository.getOrganizationWithRelationsById(id, tx);
      if (!organization) {
        return;
      }

      const serializedMetadata = buildOrganizationDesignMdMetadataUpdate(
        organization.metadata,
        {
          extractionId: null,
          url: null,
        },
      );

      await organizationRepository.updateOrganizationById(
        id,
        { metadata: serializedMetadata },
        tx,
      );
    });

    return empty(c);
  });
}
