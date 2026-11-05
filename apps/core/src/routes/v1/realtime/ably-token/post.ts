import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { isValidAblyClientInstanceId } from "@sokosumi/utils";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { createAblyClientTokenRequest } from "@/lib/ably/create-token-request";
import prisma from "@/lib/db/prisma";
import {
  type EnvVariables,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { ablyTokenRequestSchema } from "@/schemas/ably-token.schema";

const roomIdSchema = z.uuid();

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/ably-token",
    description:
      "Mint an Ably TokenRequest for Realtime. Grants chat room subscribe for the caller's memberships, narrowed to the rooms named by roomIds when present, exact per-user Calendar workspace subscribe, always-on chat and Calendar control, user task/notification/job wildcards, and org presence (ADR-0003). Pass clientInstanceId as a query param (Ably authParams) for multi-device clientId. Call after join/leave or on revoke so capabilities refresh.",
    tags: ["Realtime"],
    request: {
      query: z.object({
        clientInstanceId: z.string().optional(),
        roomIds: z
          .string()
          .optional()
          .refine(
            (value) =>
              value === undefined ||
              value === "" ||
              value
                .split(",")
                .every((id) => roomIdSchema.safeParse(id).success),
            "roomIds must contain comma-separated UUIDs",
          )
          .openapi({
            description:
              "Optional chat room scope. Omit for every membership, send an empty value for no chat rooms, or comma-separated room UUIDs. Only current memberships receive grants.",
          }),
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
      422: jsonErrorResponse("Unprocessable Entity"),
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

    const { clientInstanceId: requestedClientInstanceId, roomIds } =
      c.req.valid("query");
    const clientInstanceId =
      requestedClientInstanceId ?? FALLBACK_CLIENT_INSTANCE_ID;

    if (!isValidAblyClientInstanceId(clientInstanceId)) {
      throw badRequest("Invalid clientInstanceId");
    }

    const requestedRoomIds =
      roomIds === undefined ? undefined : roomIds.split(",").filter(Boolean);

    const [roomMemberships, orgMemberships, workspaces] = await Promise.all([
      prisma.chatRoomUserMember.findMany({
        where: {
          userId: userContext.userId,
          ...(requestedRoomIds ? { roomId: { in: requestedRoomIds } } : {}),
        },
        select: { roomId: true },
      }),
      prisma.member.findMany({
        where: { userId: userContext.userId },
        select: { organizationId: true },
      }),
      prisma.workspace.findMany({
        where: {
          OR: [
            { userId: userContext.userId },
            {
              organization: {
                members: { some: { userId: userContext.userId } },
              },
            },
          ],
        },
        select: { id: true },
      }),
    ]);

    const tokenRequest = await createAblyClientTokenRequest({
      userId: userContext.userId,
      roomIds: roomMemberships.map((m) => m.roomId),
      organizationIds: orgMemberships.map((m) => m.organizationId),
      workspaceIds: workspaces.map((workspace) => workspace.id),
      clientInstanceId,
    });

    return ok(c, ablyTokenRequestSchema.parse(tokenRequest));
  });
}
