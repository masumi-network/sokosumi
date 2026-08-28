import { createRoute } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  isPrismaUniqueViolation,
  isSlugUniqueConstraintError,
} from "@/helpers/prisma";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  requireSanitizedChannelSlug,
  resolveChannelName,
} from "@/routes/v1/chats/rooms/helpers";
import {
  adminCreateMatchedChannelBodySchema,
  adminMatchedChannelOptionSchema,
} from "@/schemas/admin.schema";

function throwSlugTaken(): never {
  throw conflict("This Channel slug is taken.", {
    kind: CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN,
  });
}

const route = createRoute({
  method: "post",
  path: "/",
  operationId: "createAdminMatchedChannel",
  description:
    "Create a live org-less matched channel (admin only). Forces `kind=channel`, `organizationId=null`, and `discoverability=matched`. Does not add the creating admin to the roster.",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: adminCreateMatchedChannelBodySchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      adminMatchedChannelOptionSchema,
      "Created matched channel",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const admin = requireAdminAuthContext(c.var.authContext);
    const body = c.req.valid("json");

    const slug = requireSanitizedChannelSlug(body.slug);
    const name = resolveChannelName(body.name, slug);

    const existing = await prisma.chatRoom.findFirst({
      where: {
        kind: "channel",
        organizationId: null,
        slug,
      },
      select: { id: true },
    });
    if (existing) {
      throwSlugTaken();
    }

    try {
      const room = await prisma.chatRoom.create({
        data: {
          organizationId: null,
          createdByUserId: admin.userId,
          kind: "channel",
          discoverability: "matched",
          name,
          slug,
          topic: body.topic?.trim() || null,
        },
        select: { id: true, name: true, slug: true },
      });

      return created(
        c,
        adminMatchedChannelOptionSchema.parse({
          id: room.id,
          name: room.name,
          slug: room.slug ?? slug,
        }),
      );
    } catch (error) {
      // This create only has slug uniqueness. Driver adapters sometimes omit
      // P2002 meta.target, so treat any unique violation as slug taken.
      if (
        isSlugUniqueConstraintError(error) ||
        isPrismaUniqueViolation(error)
      ) {
        throwSlugTaken();
      }
      throw error;
    }
  });
}
