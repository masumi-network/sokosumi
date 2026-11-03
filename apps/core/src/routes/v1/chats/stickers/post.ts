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
    "Upload raw PNG, JPEG or WebP image bytes (not multipart), up to 2 MiB, to the signed-in user's collection. Send the image MIME type in Content-Type and the original filename in the filename query parameter. Checks declared type and file bytes before storing. Like chat attachments, sent sticker URLs are public Blob URLs.",
  request: {
    query: z.object({ filename: z.string().min(1).max(255) }),
    body: {
      required: true,
      content: {
        "image/png": { schema: z.string().openapi({ format: "binary" }) },
        "image/jpeg": { schema: z.string().openapi({ format: "binary" }) },
        "image/webp": { schema: z.string().openapi({ format: "binary" }) },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(chatStickerSchema, "Sticker saved"),
    400: jsonErrorResponse("Invalid image"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    413: jsonErrorResponse("Image too large"),
    422: jsonErrorResponse("Invalid filename"),
    503: jsonErrorResponse("Storage unavailable"),
  },
});
export default function mount(app: OpenAPIHonoWithAuth) {
  app.use(
    "/",
    bodyLimit({
      maxSize: CHAT_STICKER_MAX_SIZE_BYTES,
      onError: () => {
        throw payloadTooLarge("Choose an image no larger than 2 MiB.");
      },
    }),
  );
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { filename } = c.req.valid("query");
    const declaredType = c.req
      .header("Content-Type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!declaredType || !CHAT_STICKER_CONTENT_TYPES.includes(declaredType))
      throw badRequest("Choose a PNG, JPEG or WebP image.");
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.length === 0) throw badRequest("Choose an image file.");
    if (bytes.length > CHAT_STICKER_MAX_SIZE_BYTES)
      throw payloadTooLarge("Choose an image no larger than 2 MiB.");
    const contentType = sniffImageMimeFromBytes(bytes);
    if (
      !contentType ||
      !CHAT_STICKER_CONTENT_TYPES.includes(contentType) ||
      contentType !== declaredType
    )
      throw badRequest(
        "File content must match its PNG, JPEG or WebP image type.",
      );
    return created(
      c,
      await saveChatSticker(userId, bytes, filename, contentType),
    );
  });
}
