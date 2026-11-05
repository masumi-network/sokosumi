import { z } from "@hono/zod-openapi";

export const CHAT_STICKER_MAX_SIZE_BYTES = 2 * 1024 * 1024;
export const CHAT_STICKER_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

export const chatStickerSchema = z
  .object({
    url: z.url(),
    name: z.string(),
  })
  .openapi("ChatSticker");
