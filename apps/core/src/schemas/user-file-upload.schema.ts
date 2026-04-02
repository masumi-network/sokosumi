import { z } from "@hono/zod-openapi";

export const createUserFileUploadRequestSchema = z
  .object({
    filename: z.string().min(1).max(512).openapi({
      example: "report.pdf",
      description: "Original file name supplied by the client",
    }),
    contentType: z.string().min(1).max(255).openapi({
      example: "application/pdf",
      description: "Detected file content type",
    }),
    size: z.number().int().positive().openapi({
      example: 2_048_000,
      description: "File size in bytes",
    }),
  })
  .openapi("CreateUserFileUploadRequest");

export const userFileUploadSessionSchema = z
  .object({
    clientToken: z.string().openapi({
      example: "vercel_blob_client_token",
      description: "Scoped Blob client token for direct uploads",
    }),
    access: z.literal("public").openapi({
      example: "public",
      description: "Blob access level for the upload",
    }),
    pathname: z.string().openapi({
      example: "users/user_123/report.pdf",
      description: "Server-generated upload pathname",
    }),
    addRandomSuffix: z.boolean().openapi({
      example: true,
      description: "Whether Blob should append a random suffix",
    }),
    maxSizeBytes: z.number().int().positive().openapi({
      example: 262_144_000,
      description: "Maximum supported file size for direct uploads",
    }),
  })
  .openapi("UserFileUploadSession");

export type CreateUserFileUploadRequest = z.infer<
  typeof createUserFileUploadRequestSchema
>;
export type UserFileUploadSession = z.infer<typeof userFileUploadSessionSchema>;
