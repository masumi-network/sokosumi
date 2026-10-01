import { createRoute, z } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Badge campaign ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}",
  operationId: "deleteAdminBadgeCampaign",
  description:
    "Delete a badge campaign that has not started (admin only). A started campaign is ended instead, so who saw it is kept.",
  tags: ["Admin"],
  request: { params },
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

    const campaign = await prisma.badgeCampaign.findUnique({
      where: { id },
      select: { startsAt: true },
    });
    if (!campaign) {
      throw notFound("Badge campaign not found");
    }
    if (campaign.startsAt <= new Date()) {
      throw conflict("A started campaign cannot be deleted; end it instead");
    }

    await prisma.badgeCampaign.delete({ where: { id } });

    return c.body(null, 204);
  });
}
