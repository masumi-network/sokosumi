import { z } from "@hono/zod-openapi";

import { blobUploadGrantSchema } from "@/schemas/blob-upload-grant.schema";

export const createChatRoomFileUploadSessionRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(512).openapi({
      example: "report.pdf",
      description: "Original file name supplied by the client",
    }),
    contentType: z.string().trim().min(1).max(255).openapi({
      example: "application/pdf",
      description:
        "Declared MIME type. May be inferred from the filename when generic.",
    }),
    size: z.number().int().positive().openapi({
      example: 2_048_000,
      description: "File size in bytes",
    }),
  })
  .openapi("CreateChatRoomFileUploadSessionRequest");

export const chatRoomFileUploadSessionSchema = blobUploadGrantSchema.openapi(
  "ChatRoomFileUploadSession",
);
