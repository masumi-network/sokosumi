import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { listChatStickers } from "@/lib/chat-stickers";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatStickerSchema } from "@/schemas/chat-sticker.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listChatStickers",
  tags: ["Chat Rooms"],
  description:
    "List the signed-in user's saved stickers. Collection ownership is independent of the active workspace.",
  responses: {
    200: jsonSuccessResponse(z.array(chatStickerSchema), "Saved stickers"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    503: jsonErrorResponse("Storage unavailable"),
  },
});
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return ok(c, await listChatStickers(userId));
  });
}
