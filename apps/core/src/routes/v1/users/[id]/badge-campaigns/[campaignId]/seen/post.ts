import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  campaignId: z.string().openapi({
    param: { name: "campaignId", in: "path" },
    description: "Badge campaign ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const route = createRoute({
  method: "post",
  path: "/badge-campaigns/{campaignId}/seen",
  operationId: "markUserBadgeCampaignSeen",
  description:
    "Record that the user opened the campaign's feature, which removes its New badge for this campaign. Repeating it is a no-op.",
  tags: ["Users"],
  request: { params },
  responses: {
    204: { description: "Campaign marked seen" },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - campaign missing"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { campaignId } = c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const campaign = await prisma.badgeCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true },
    });
    if (!campaign) {
      throw notFound("Badge campaign not found");
    }

    await prisma.badgeCampaignSeen.createMany({
      data: [{ userId: resolvedUserId, campaignId }],
      skipDuplicates: true,
    });

    return empty(c);
  });
}
