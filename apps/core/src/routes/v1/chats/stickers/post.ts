import { createRoute, z } from "@hono/zod-openapi";
import { sniffImageMimeFromBytes } from "@sokosumi/utils";
import { bodyLimit } from "hono/body-limit";
import { badRequest, payloadTooLarge } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { saveChatSticker } from "@/lib/chat-stickers";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  CHAT_STICKER_CONTENT_TYPES,
  CHAT_STICKER_MAX_SIZE_BYTES,
  chatStickerSchema,
} from "@/schemas/chat-sticker.schema";

const route = createRoute({
  method: "post",
  path: "/",
  operationId: "uploadChatSticker",
  tags: ["Chat Rooms"],
  description:
    "Upload a PNG, JPEG or WebP sticker, up to 2 MiB, to the signed-in user's collection. Checks file bytes before storing. Like chat attachments, sent sticker URLs are public Blob URLs.",
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any().openapi({ type: "string", format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(chatStickerSchema, "Sticker saved"),
    400: jsonErrorResponse("Invalid image"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    413: jsonErrorResponse("Image too large"),
    503: jsonErrorResponse("Storage unavailable"),
  },
});
export default function mount(app: OpenAPIHonoWithAuth) {
  app.use(
    "/",
    bodyLimit({
      maxSize: CHAT_STICKER_MAX_SIZE_BYTES + 256 * 1024,
      onError: () => {
        throw payloadTooLarge("Choose an image no larger than 2 MiB.");
      },
    }),
  );
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const body = await c.req.parseBody({ all: true });
    const file = body.file;
    if (!(file instanceof File) || file.size === 0)
      throw badRequest("Choose an image file.");
    if (file.size > CHAT_STICKER_MAX_SIZE_BYTES)
      throw payloadTooLarge("Choose an image no larger than 2 MiB.");
    if (!CHAT_STICKER_CONTENT_TYPES.includes(file.type))
      throw badRequest("Choose a PNG, JPEG or WebP image.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const contentType = sniffImageMimeFromBytes(bytes);
    if (!contentType || !CHAT_STICKER_CONTENT_TYPES.includes(contentType))
      throw badRequest("File content must be a PNG, JPEG or WebP image.");
    return created(
      c,
      await saveChatSticker(userId, bytes, file.name, contentType),
    );
  });
}
