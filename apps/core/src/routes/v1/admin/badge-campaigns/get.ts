import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  ANNOUNCED_FEATURES,
  badgeCampaignSchema,
} from "@/schemas/badge-campaign.schema";

const badgeCampaignListSchema = z
  .array(badgeCampaignSchema)
  .openapi("AdminBadgeCampaignList");

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminBadgeCampaigns",
  description: "List all badge campaigns, latest start first (admin only).",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(badgeCampaignListSchema, "List of campaigns"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const campaigns = await prisma.badgeCampaign.findMany({
      where: { feature: { in: [...ANNOUNCED_FEATURES] } },
      orderBy: [{ startsAt: "desc" }],
    });

    return ok(c, badgeCampaignListSchema.parse(campaigns));
  });
}
