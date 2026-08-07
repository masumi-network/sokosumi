import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { createAblySubscribeTokenRequest } from "@/lib/ably/create-token-request";
import prisma from "@/lib/db/prisma";
import {
  type EnvVariables,
  withOrchestratorContextHeaderParameters,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { ablyTokenRequestSchema } from "@/schemas/ably-token.schema";

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/ably-token",
    description:
      "Mint an Ably TokenRequest for Realtime subscribe. Grants per-membership chat room channels, always-on chat control (membership revoke), plus user task/notification/job wildcards. Call after join/leave or on revoke so capabilities refresh.",
    tags: ["Realtime"],
    responses: {
      200: jsonSuccessResponse(
        ablyTokenRequestSchema,
        "Ably TokenRequest created",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(
  app: OpenAPIHono<{ Variables: EnvVariables["Variables"] }>,
) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);

    const memberships = await prisma.chatRoomUserMember.findMany({
      where: { userId: userContext.userId },
      select: { roomId: true },
    });

    const tokenRequest = await createAblySubscribeTokenRequest(
      userContext.userId,
      memberships.map((m) => m.roomId),
    );

    return ok(c, ablyTokenRequestSchema.parse(tokenRequest));
  });
}
