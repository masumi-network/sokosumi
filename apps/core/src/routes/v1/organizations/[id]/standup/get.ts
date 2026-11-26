import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { teamStandupSchema } from "@/schemas/team-standup.schema";
import { getTeamStandup } from "@/services/team-standup-settings.service";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/standup",
  operationId: "getOrganizationStandup",
  description:
    "The organization's daily agent stand-up: on or off, its channel, time, weekdays and time zone. Any member may read it.",
  tags: ["Organizations"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(teamStandupSchema, "The stand-up settings"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - Organization not found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
    });
    return ok(c, await getTeamStandup(organization.id));
  });
}
