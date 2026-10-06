import { createRoute, z } from "@hono/zod-openapi";
import { assertChatMessageReadBudget } from "@/helpers/chat-message-read-budget";
import {
  RESULT_SNAPSHOTS_KEY,
  readChatResultSnapshots,
} from "@/helpers/chat-result-metadata";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatResultPreviewSchema } from "@/schemas/chat-result-preview.schema";
import { hydrateChatResultSnapshots } from "@/services/chat-result-preview.service";
import { requireChatRoomUserMembership } from "../../../../helpers";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/messages/{messageId}/results",
    operationId: "getChatRoomMessageResults",
    tags: ["Chat Rooms"],
    request: {
      params: z.object({ id: z.string().uuid(), messageId: z.string().uuid() }),
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(chatResultPreviewSchema),
        "Authorized recorded message results",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      429: jsonErrorResponse("Read budget exceeded"),
    },
  }),
);
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    c.header("Cache-Control", "private, no-store");
    const auth = requireUserAuthContext(c.var.authContext);
    const { id, messageId } = c.req.valid("param");
    await requireChatRoomUserMembership(id, auth.userId, prisma);
    await assertChatMessageReadBudget(auth.userId);
    const message = await prisma.chatRoomMessage.findFirst({
      where: { id: messageId, roomId: id, deletedAt: null },
      select: { metadata: true },
    });
    if (!message) throw notFound("Message not found");
    const metadata = message.metadata;
    const snapshots = readChatResultSnapshots(
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata[RESULT_SNAPSHOTS_KEY]
        : null,
    );
    return ok(c, await hydrateChatResultSnapshots(snapshots, auth.userId));
  });
}
