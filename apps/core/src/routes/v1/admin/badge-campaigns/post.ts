import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  badgeCampaignSchema,
  createBadgeCampaignRequestSchema,
} from "@/schemas/badge-campaign.schema";

import { assertNoOverlappingBadgeCampaign } from "./overlap";

const route = createRoute({
  method: "post",
  path: "/",
  operationId: "createAdminBadgeCampaign",
  description: "Create a badge campaign (admin only).",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": { schema: createBadgeCampaignRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(badgeCampaignSchema, "The created campaign"),
    422: jsonErrorResponse("Unprocessable Entity - validation failed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse(
      "Conflict - another campaign for this feature overlaps",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireAdminAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);

    await assertNoOverlappingBadgeCampaign({
      feature: body.feature,
      startsAt,
      endsAt,
    });

    const campaign = await prisma.badgeCampaign.create({
      data: { feature: body.feature, startsAt, endsAt, createdById: userId },
    });

    return ok(c, badgeCampaignSchema.parse(campaign));
  });
}
