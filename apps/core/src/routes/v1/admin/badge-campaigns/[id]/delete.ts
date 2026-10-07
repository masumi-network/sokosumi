import { createRoute } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { badgeCampaignIdParamsSchema } from "@/schemas/badge-campaign.schema";

import { lockBadgeCampaign } from "../campaign-lock";

const route = createRoute({
  method: "delete",
  path: "/{id}",
  operationId: "deleteAdminBadgeCampaign",
  description:
    "Delete a badge campaign that has not started (admin only). A started campaign is ended instead, so who saw it is kept.",
  tags: ["Admin"],
  request: { params: badgeCampaignIdParamsSchema },
  responses: {
    204: { description: "Campaign deleted" },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - campaign missing"),
    409: jsonErrorResponse("Conflict - campaign has started"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    await serializableTransaction(async (tx) => {
      await lockBadgeCampaign(tx, id);
      const campaign = await tx.badgeCampaign.findUnique({
        where: { id },
        select: { startsAt: true },
      });
      if (!campaign) {
        throw notFound("Badge campaign not found");
      }
      if (campaign.startsAt <= new Date()) {
        throw conflict("A started campaign cannot be deleted; end it instead");
      }

      const deleted = await tx.$executeRaw`
        DELETE FROM "badge_campaign" WHERE "id" = ${id}
          AND "startsAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      `;
      if (!deleted)
        throw conflict("A started campaign cannot be deleted; end it instead");
    }, "Badge campaign changed concurrently; try again");

    return empty(c);
  });
}
