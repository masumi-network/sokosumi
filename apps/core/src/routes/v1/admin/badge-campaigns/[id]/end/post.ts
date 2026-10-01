import { createRoute } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  badgeCampaignIdParamsSchema,
  badgeCampaignSchema,
} from "@/schemas/badge-campaign.schema";

const route = createRoute({
  method: "post",
  path: "/{id}/end",
  operationId: "endAdminBadgeCampaign",
  description:
    "End a running badge campaign now, by Core's clock (admin only). Who saw it is kept.",
  tags: ["Admin"],
  request: { params: badgeCampaignIdParamsSchema },
  responses: {
    200: jsonSuccessResponse(badgeCampaignSchema, "The ended campaign"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - campaign missing"),
    409: jsonErrorResponse("Conflict - campaign is not running"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const now = new Date();

    const campaign = await prisma.badgeCampaign.findUnique({ where: { id } });
    if (!campaign) {
      throw notFound("Badge campaign not found");
    }
    if (campaign.startsAt > now || campaign.endsAt <= now) {
      throw conflict("Only a running campaign can be ended");
    }

    const ended = await prisma.badgeCampaign.update({
      where: { id },
      data: { endsAt: now },
    });

    return ok(c, badgeCampaignSchema.parse(ended));
  });
}
