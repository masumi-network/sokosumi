import { createRoute } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  badgeCampaignIdParamsSchema,
  badgeCampaignSchema,
} from "@/schemas/badge-campaign.schema";

import { lockBadgeCampaign } from "../../campaign-lock";
import { assertNoOverlappingBadgeCampaign } from "../../overlap";

const route = createRoute({
  method: "post",
  path: "/{id}/start",
  operationId: "startAdminBadgeCampaign",
  description:
    "Start a scheduled badge campaign now, by Core's clock (admin only). Its end stays as set.",
  tags: ["Admin"],
  request: { params: badgeCampaignIdParamsSchema },
  responses: {
    200: jsonSuccessResponse(badgeCampaignSchema, "The started campaign"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - campaign missing"),
    409: jsonErrorResponse(
      "Conflict - campaign has started, or starting now overlaps another campaign for this feature",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const started = await serializableTransaction(async (tx) => {
      await lockBadgeCampaign(tx, id);
      const campaign = await tx.badgeCampaign.findUnique({ where: { id } });
      if (!campaign) {
        throw notFound("Badge campaign not found");
      }
      const now = new Date();
      if (campaign.startsAt <= now) {
        throw conflict("Only a scheduled campaign can be started now");
      }
      // Starting early widens the window, so it can reach another campaign.
      await assertNoOverlappingBadgeCampaign(tx, {
        feature: campaign.feature,
        startsAt: now,
        endsAt: campaign.endsAt,
        excludeId: id,
      });

      const updated = await tx.$executeRaw`
        WITH clock AS (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now)
        UPDATE "badge_campaign" SET "startsAt" = ${now}, "updatedAt" = ${now}
        FROM clock WHERE "id" = ${id}
          AND "startsAt" > clock.now AND "endsAt" > clock.now
      `;
      if (!updated) {
        throw conflict("Only a scheduled campaign can be started now");
      }
      return tx.badgeCampaign.findUniqueOrThrow({ where: { id } });
    }, "Badge campaign changed concurrently; try again");

    return ok(c, badgeCampaignSchema.parse(started));
  });
}
