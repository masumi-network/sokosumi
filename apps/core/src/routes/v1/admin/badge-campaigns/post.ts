import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
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

    const campaign = await serializableTransaction(async (tx) => {
      await assertNoOverlappingBadgeCampaign(tx, {
        feature: body.feature,
        startsAt,
        endsAt,
      });

      return tx.badgeCampaign.create({
        data: { feature: body.feature, startsAt, endsAt, createdById: userId },
      });
    }, "Badge campaigns changed concurrently; try again");

    return ok(c, badgeCampaignSchema.parse(campaign));
  });
}
