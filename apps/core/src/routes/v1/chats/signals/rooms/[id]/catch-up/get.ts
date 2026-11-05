import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomCatchUpSchema } from "@/schemas/chat-signal.schema";
import { getChatRoomCatchUp } from "@/services/chat-signal-views.service";
import { roomParamsSchema } from "../../../params";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/rooms/{id}/catch-up",
    description:
      "What a room holds for the viewer since they last read it, one bucket per unread message by what Jev read in it (chat signals): the catch-up line of a busy channel. Each bucket lists its message ids, oldest first, to jump to.",
    tags: ["Chat Signals"],
    request: { params: roomParamsSchema },
    responses: {
      200: jsonSuccessResponse(chatRoomCatchUpSchema, "Room catch-up"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    return ok(
      c,
      chatRoomCatchUpSchema.parse(await getChatRoomCatchUp(id, userId)),
    );
  });
}
