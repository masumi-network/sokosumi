import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const userFileMetadataSchema = z
  .object({
    pathname: z.string().openapi({
      example: "users/user_123/document_abc.pdf",
      description: "Blob pathname within storage",
    }),
    downloadUrl: z.string().openapi({
      example: "https://store.public.blob.vercel-storage.com/document_abc.pdf?download=1",
      description: "Direct download URL",
    }),
    size: z.number().openapi({
      example: 2048000,
      description: "File size in bytes",
    }),
    uploadedAt: dateTimeSchema,
    etag: z.string().openapi({
      example: '"a1b2c3d4"',
      description: "Blob entity tag",
    }),
  })
  .openapi("UserFileMetadata");

export const userFileSchema = z
  .object({
    publicUrl: z.string().openapi({
      example: "https://store.public.blob.vercel-storage.com/users/user_123/document_abc.pdf",
      description: "Public URL of the uploaded file",
    }),
    metadata: userFileMetadataSchema,
  })
  .openapi("UserFile");

export const userFilesSchema = z.array(userFileSchema);

export type UserFile = z.infer<typeof userFileSchema>;
export type UserFileMetadata = z.infer<typeof userFileMetadataSchema>;
