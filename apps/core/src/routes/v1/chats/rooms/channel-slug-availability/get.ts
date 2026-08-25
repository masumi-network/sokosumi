import { createRoute, z } from "@hono/zod-openapi";
import { sanitizeChannelSlug } from "@sokosumi/utils";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { channelSlugAvailabilitySchema } from "@/schemas/chat-room.schema";

import { requireActiveOrganizationId } from "../helpers";

const querySchema = z.object({
  slug: z.string().openapi({
    param: { name: "slug", in: "query" },
    description:
      "Channel slug to check. Sanitized with the same kebab rules as create.",
    example: "team-soko",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/channel-slug-availability",
    description:
      "Check whether a Channel slug is free in the active organization. Occupancy includes private and archived Channels. The response is free or taken and does not identify the occupant.",
    tags: ["Chat Rooms"],
    request: {
      query: querySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        channelSlugAvailabilitySchema,
        "Channel slug availability",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Organization not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const organizationId = requireActiveOrganizationId(userContext);
    const { slug: rawSlug } = c.req.valid("query");
    const slug = sanitizeChannelSlug(rawSlug);
    if (!slug) {
      throw badRequest("Channel slug is invalid");
    }

    await resolveMemberOrganizationById({
      id: organizationId,
      userId: userContext.userId,
      tx: prisma,
    });

    const occupant = await prisma.chatRoom.findFirst({
      where: {
        organizationId,
        kind: "channel",
        slug,
      },
      select: { id: true },
    });

    return ok(
      c,
      channelSlugAvailabilitySchema.parse({
        status: occupant ? "taken" : "free",
      }),
    );
  });
}
