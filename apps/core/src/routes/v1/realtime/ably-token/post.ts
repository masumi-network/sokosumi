import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { isValidAblyClientInstanceId } from "@sokosumi/utils";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { createAblyClientTokenRequest } from "@/lib/ably/create-token-request";
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
      "Mint an Ably TokenRequest for Realtime. Grants per-membership chat room subscribe, always-on chat control, user task/notification/job wildcards, and org presence (ADR-0003). Pass clientInstanceId as a query param (Ably authParams) for multi-device clientId. Call after join/leave or on revoke so capabilities refresh.",
    tags: ["Realtime"],
    request: {
      query: z.object({
        clientInstanceId: z.string().optional(),
      }),
    },
    responses: {
      200: jsonSuccessResponse(
        ablyTokenRequestSchema,
        "Ably TokenRequest created",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

const FALLBACK_CLIENT_INSTANCE_ID = "default00";

export default function mount(
  app: OpenAPIHono<{ Variables: EnvVariables["Variables"] }>,
) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);

    const clientInstanceId =
      c.req.valid("query").clientInstanceId ?? FALLBACK_CLIENT_INSTANCE_ID;

    if (!isValidAblyClientInstanceId(clientInstanceId)) {
      throw badRequest("Invalid clientInstanceId");
    }

    const [roomMemberships, orgMemberships] = await Promise.all([
      prisma.chatRoomUserMember.findMany({
        where: { userId: userContext.userId },
        select: { roomId: true },
      }),
      prisma.member.findMany({
        where: { userId: userContext.userId },
        select: { organizationId: true },
      }),
    ]);

    const tokenRequest = await createAblyClientTokenRequest({
      userId: userContext.userId,
      roomIds: roomMemberships.map((m) => m.roomId),
      organizationIds: orgMemberships.map((m) => m.organizationId),
      clientInstanceId,
    });

    return ok(c, ablyTokenRequestSchema.parse(tokenRequest));
  });
}
