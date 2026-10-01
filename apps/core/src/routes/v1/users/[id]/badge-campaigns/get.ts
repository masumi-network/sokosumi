import { createRoute, z } from "@hono/zod-openapi";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  ANNOUNCED_FEATURES,
  userBadgeCampaignsResponseSchema,
} from "@/schemas/badge-campaign.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/badge-campaigns",
  operationId: "getUserBadgeCampaigns",
  description:
    "Badge campaigns whose New badge the user should see now: running, started after the user signed up, and not yet seen.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      userBadgeCampaignsResponseSchema,
      "Campaigns to badge for the user",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      select: { createdAt: true },
    });
    if (!user) {
      throw internalServerError("Failed to retrieve user");
    }

    const now = new Date();
    const badgeCampaigns = await prisma.badgeCampaign.findMany({
      where: {
        feature: { in: [...ANNOUNCED_FEATURES] },
        startsAt: { lte: now, gt: user.createdAt },
        endsAt: { gt: now },
        seenBy: { none: { userId: resolvedUserId } },
      },
      select: { id: true, feature: true },
    });

    return ok(c, userBadgeCampaignsResponseSchema.parse({ badgeCampaigns }));
  });
}
