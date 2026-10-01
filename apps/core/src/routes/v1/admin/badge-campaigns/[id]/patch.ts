import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  badgeCampaignSchema,
  updateBadgeCampaignRequestSchema,
} from "@/schemas/badge-campaign.schema";

import { assertNoOverlappingBadgeCampaign } from "../overlap";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Badge campaign ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "updateAdminBadgeCampaign",
  description:
    "Move a badge campaign's start and end (admin only). End a live campaign by setting its end to now.",
  tags: ["Admin"],
  request: {
    params,
    body: {
      content: {
        "application/json": { schema: updateBadgeCampaignRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(badgeCampaignSchema, "The updated campaign"),
    422: jsonErrorResponse("Unprocessable Entity - validation failed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - campaign missing"),
    409: jsonErrorResponse(
      "Conflict - another campaign for this feature overlaps",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);

    const existing = await prisma.badgeCampaign.findUnique({ where: { id } });
    if (!existing) {
      throw notFound("Badge campaign not found");
    }

    await assertNoOverlappingBadgeCampaign({
      feature: existing.feature,
      startsAt,
      endsAt,
      excludeId: id,
    });

    const campaign = await prisma.badgeCampaign.update({
      where: { id },
      data: { startsAt, endsAt },
    });

    return ok(c, badgeCampaignSchema.parse(campaign));
  });
}
