import { z } from "@hono/zod-openapi";

/**
 * Shared fields for REST direct-upload grants (user + task mint responses).
 * Clients PUT raw bytes to `uploadUrl`; agents need no Blob SDK.
 */
export const blobUploadGrantSchema = z
  .object({
    uploadUrl: z.string().url().openapi({
      example:
        "https://store.public.blob.vercel-storage.com/users/user_123/report.pdf?vercel-blob-delegation=…",
      description: "Presigned Blob PUT URL (time-scoped, path-scoped)",
    }),
    pathname: z.string().openapi({
      example: "users/user_123/report.pdf",
      description: "Server-generated upload pathname (before random suffix)",
    }),
    access: z.literal("public").openapi({
      example: "public",
      description: "Blob access level for the upload",
    }),
    method: z.literal("PUT").openapi({
      example: "PUT",
      description: "HTTP method for the client upload request",
    }),
    headers: z
      .object({
        "Content-Type": z.string().openapi({
          example: "application/pdf",
        }),
      })
      .openapi({
        description: "Headers the client must send on the PUT",
      }),
    expiresAt: z.string().datetime().openapi({
      example: "2026-07-30T12:15:00.000Z",
      description: "When the presigned upload URL expires (ISO-8601)",
    }),
    maxSizeBytes: z.number().int().positive().openapi({
      example: 52_428_800,
      description: "Maximum supported file size for this upload policy",
    }),
    addRandomSuffix: z.boolean().openapi({
      example: true,
      description: "Whether Blob appends a random suffix to the final pathname",
    }),
    clientToken: z.string().optional().openapi({
      example: "vercel_blob_client_token",
      description:
        "Legacy scoped client token for `@vercel/blob/client` `put`. Prefer `uploadUrl` for agents.",
    }),
  })
  .openapi("BlobUploadGrant");

export type BlobUploadGrantDto = z.infer<typeof blobUploadGrantSchema>;
