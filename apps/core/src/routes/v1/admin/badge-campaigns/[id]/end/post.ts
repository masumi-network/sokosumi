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

    const ended = await serializableTransaction(async (tx) => {
      await lockBadgeCampaign(tx, id);
      const campaign = await tx.badgeCampaign.findUnique({ where: { id } });
      if (!campaign) {
        throw notFound("Badge campaign not found");
      }
      const now = new Date();
      if (campaign.startsAt > now || campaign.endsAt <= now) {
        throw conflict("Only a running campaign can be ended");
      }

      const updated = await tx.$executeRaw`
        WITH clock AS (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now)
        UPDATE "badge_campaign" SET "endsAt" = ${now}, "updatedAt" = ${now}
        FROM clock WHERE "id" = ${id}
          AND "startsAt" <= clock.now AND "endsAt" > clock.now
      `;
      if (!updated) throw conflict("Only a running campaign can be ended");
      return tx.badgeCampaign.findUniqueOrThrow({ where: { id } });
    }, "Badge campaign changed concurrently; try again");

    return ok(c, badgeCampaignSchema.parse(ended));
  });
}
