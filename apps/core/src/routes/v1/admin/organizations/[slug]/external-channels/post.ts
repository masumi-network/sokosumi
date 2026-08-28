import { createRoute } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { getAdminOrganizationBySlug } from "@/helpers/admin-organization-overview.js";
import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  requireSanitizedChannelSlug,
  resolveChannelName,
} from "@/routes/v1/chats/rooms/helpers";
import {
  adminCreateExternalChannelBodySchema,
  adminExternalChannelOptionSchema,
  adminOrganizationSlugParamSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "post",
  path: "/{slug}/external-channels",
  operationId: "createAdminOrgExternalChannel",
  description:
    "Create a live External channel owned by the organization (admin only). Forces `kind=channel` and `discoverability=external`. Does not seed the platform admin as a room member.",
  tags: ["Admin"],
  request: {
    params: adminOrganizationSlugParamSchema,
    body: {
      content: {
        "application/json": {
          schema: adminCreateExternalChannelBodySchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      adminExternalChannelOptionSchema,
      "Created External channel",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const admin = requireAdminAuthContext(c.var.authContext);
    const { slug: orgSlug } = c.req.valid("param");
    const body = c.req.valid("json");

    const organization = await getAdminOrganizationBySlug(orgSlug, prisma);
    if (!organization) {
      throw notFound("Organization not found");
    }

    const slug = requireSanitizedChannelSlug(body.slug);
    const name = resolveChannelName(body.name, slug);

    try {
      const room = await prisma.chatRoom.create({
        data: {
          organizationId: organization.id,
          createdByUserId: admin.userId,
          kind: "channel",
          discoverability: "external",
          name,
          slug,
          topic: body.topic?.trim() || null,
        },
        select: { id: true, name: true, slug: true },
      });

      return created(
        c,
        adminExternalChannelOptionSchema.parse({
          id: room.id,
          name: room.name,
          slug: room.slug ?? slug,
        }),
      );
    } catch (error) {
      if (isSlugUniqueConstraintError(error)) {
        throw conflict("This Channel slug is taken.", {
          kind: CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN,
        });
      }
      throw error;
    }
  });
}
