import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { chatRoomSchema } from "@/schemas/chat-room.schema";

import {
  chatRoomInclude,
  elsewhereActiveRoomWhere,
  getChatRoomSidebarFlags,
} from "../helpers";
import { getChatRoomUnreadMentionCounts } from "../room-mention-counts";
import { getChatRoomUnreadCounts } from "../room-unread";
import { mapSidebarRooms } from "../sidebar-rooms";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/elsewhere",
    description:
      "List the current user's rooms with something unread in their other workspaces (Elsewhere rows, ADR-0061): rooms of an Organization they belong to, or their personal coworker and Soko Bot Directs, that the active workspace does not list and they have not muted. Rooms naming the user come first, then the newest. Unpaginated: the whole list. Interactive user session only.",
    tags: ["Chat Rooms"],
    responses: {
      200: jsonSuccessResponse(
        z.array(chatRoomSchema),
        "Unread rooms of the user's other workspaces",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId, organizationId } = requireInteractiveUserAuthContext(
      c.var.authContext,
    );

    // Ids first: this runs on every message the reader's rooms receive, and
    // the rosters are only worth loading for the few rooms that qualify.
    const candidates = await prisma.chatRoom.findMany({
      where: {
        ...elsewhereActiveRoomWhere(organizationId),
        userMembers: { some: { userId, mutedAt: null } },
        // The room access rule: membership of the room and of its Organization.
        OR: [
          { organizationId: null },
          { organization: { members: { some: { userId } } } },
        ],
      },
      select: { id: true },
    });
    const candidateIds = candidates.map((room) => room.id);
    const [unreadCounts, mentionCounts, sidebarFlags] = await Promise.all([
      getChatRoomUnreadCounts(candidateIds, userId, prisma),
      getChatRoomUnreadMentionCounts(candidateIds, userId, prisma),
      getChatRoomSidebarFlags(candidateIds, userId, prisma),
    ]);
    const unreadIds = candidateIds.filter(
      (id) =>
        (unreadCounts.get(id)?.total ?? 0) > 0 ||
        (mentionCounts.get(id) ?? 0) > 0 ||
        sidebarFlags.get(id)?.markedUnread === true,
    );
    if (unreadIds.length === 0) {
      return ok(c, []);
    }

    const rooms = await prisma.chatRoom.findMany({
      where: { id: { in: unreadIds } },
      include: chatRoomInclude,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    const mapped = await mapSidebarRooms(rooms, userId, organizationId);

    return ok(c, [
      ...mapped.filter((room) => room.unreadMentionCount > 0),
      ...mapped.filter((room) => room.unreadMentionCount === 0),
    ]);
  });
}
