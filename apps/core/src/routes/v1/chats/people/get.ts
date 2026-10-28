import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { directReachableUserWhere } from "@/routes/v1/chats/rooms/helpers";
import { chatPersonSchema } from "@/schemas/chat-room.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listChatPeople",
  tags: ["Chat Rooms"],
  description:
    "List everyone the signed-in user may start a Personal Direct with: members of any of their Organizations and co-members of any External channel they are on, each once, sorted by name. Independent of the active workspace.",
  responses: {
    200: jsonSuccessResponse(z.array(chatPersonSchema), "People"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    // shortcut: unpaginated like the Organization member list the picker used; page it if rosters reach thousands.
    const people = await prisma.user.findMany({
      where: { id: { not: userId }, ...directReachableUserWhere(userId) },
      select: { id: true, name: true, email: true, image: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return ok(c, people);
  });
}
