import { createRoute } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  badgeCampaignIdParamsSchema,
  badgeCampaignSchema,
  updateBadgeCampaignRequestSchema,
} from "@/schemas/badge-campaign.schema";

import { assertNoOverlappingBadgeCampaign } from "../overlap";

const route = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "updateAdminBadgeCampaign",
  description:
    "Move a badge campaign's start and end (admin only). A started campaign's start cannot move into the future.",
  tags: ["Admin"],
  request: {
    params: badgeCampaignIdParamsSchema,
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
      "Conflict - another campaign for this feature overlaps, or a started campaign's start moves into the future",
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
    // Un-starting a campaign would make it deletable, and deleting drops who
    // saw it: a started campaign is ended, never rewound.
    const now = new Date();
    if (existing.startsAt <= now && startsAt > now) {
      throw conflict("A started campaign's start cannot move into the future");
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
