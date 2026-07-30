import { z } from "@hono/zod-openapi";

import { blobUploadGrantSchema } from "@/schemas/blob-upload-grant.schema";

export const createUserFileUploadRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(512).openapi({
      example: "report.pdf",
      description: "Original file name supplied by the client",
    }),
    contentType: z.string().trim().min(1).max(255).openapi({
      example: "application/pdf",
      description:
        "Declared file MIME type from the client. When empty or generic (e.g. application/octet-stream), the server may infer an allowed type from the filename extension.",
    }),
    size: z.number().int().positive().openapi({
      example: 2_048_000,
      description: "File size in bytes",
    }),
    maxSizeBytes: z.number().int().positive().optional().openapi({
      example: 2_097_152,
      description:
        "Optional per-upload size ceiling in bytes. Must not exceed the server maximum.",
    }),
    allowedContentTypes: z
      .array(
        z.string().trim().min(1).max(255).openapi({
          example: "image/png",
        }),
      )
      .max(32)
      .optional()
      .openapi({
        description:
          "Optional allowlist for the upload session. Every value must be supported by the server, and the selected contentType must be included.",
      }),
  })
  .openapi("CreateUserFileUploadRequest");

/** Same grant shape as task-file mint (`TaskFileUploadSession`). */
export const userFileUploadSessionSchema = blobUploadGrantSchema.openapi(
  "UserFileUploadSession",
);

export type UserFileUploadSession = z.infer<typeof userFileUploadSessionSchema>;
