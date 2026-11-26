import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  teamStandupSchema,
  updateTeamStandupSchema,
} from "@/schemas/team-standup.schema";
import {
  TeamStandupSettingsError,
  updateTeamStandup,
} from "@/services/team-standup-settings.service";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
  }),
});

const route = createRoute({
  method: "put",
  path: "/{id}/standup",
  operationId: "updateOrganizationStandup",
  description:
    "Turn the organization's daily agent stand-up on or off and set its time (HH:MM), weekdays, time zone and the weekday of its weekly week in review. Only organization owners and admins may do this.",
  tags: ["Organizations"],
  request: {
    params,
    body: {
      content: { "application/json": { schema: updateTeamStandupSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(teamStandupSchema, "The stand-up settings"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });
    try {
      return ok(c, await updateTeamStandup(organization.id, body));
    } catch (error) {
      if (error instanceof TeamStandupSettingsError)
        throw badRequest(error.message);
      throw error;
    }
  });
}
