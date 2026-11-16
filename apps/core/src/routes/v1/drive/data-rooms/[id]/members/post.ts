import { createRoute, z } from "@hono/zod-openapi";
import { getEmailLocale } from "@sokosumi/utils";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  dataRoomMemberSchema,
  inviteDataRoomMembersRequestSchema,
  toDataRoomMemberDto,
} from "@/schemas/data-room.schema";
import { sendDataRoomInvitations } from "@/services/data-room-email.service";
import { inviteDataRoomMembers } from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/members",
    description:
      "Let people into a data room by email. Each gets an invitation with the room's link; they sign in with a code sent to that address.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: {
        required: true,
        content: {
          "application/json": { schema: inviteDataRoomMembersRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(z.array(dataRoomMemberSchema), "People let in"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { scope, organizationId, expiresAt, ...invite } = c.req.valid("json");
    const userContext = await requireAuthorizedUserContext(c.var.authContext);
    const store = await resolveFileRequestContext({
      authContext: c.var.authContext,
      scope,
      organizationId,
    });
    const { room, invited } = await inviteDataRoomMembers({
      store,
      roomId: c.req.valid("param").id,
      ...invite,
      ...(expiresAt !== undefined
        ? { expiresAt: expiresAt ? new Date(expiresAt) : null }
        : {}),
      invitedByUserId: userContext.userId,
    });
    const inviter = await prisma.user.findUnique({
      where: { id: userContext.userId },
      select: { name: true, email: true },
    });
    await sendDataRoomInvitations({
      room,
      members: invited,
      inviterName: inviter?.name || inviter?.email || "Someone",
      locale: getEmailLocale(c.req.raw),
    });
    return created(
      c,
      z
        .array(dataRoomMemberSchema)
        .parse(invited.map((member) => toDataRoomMemberDto({ member }))),
    );
  });
}
