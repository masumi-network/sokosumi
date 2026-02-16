import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const blobFileMetadataSchema = z
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
  .openapi("BlobFileMetadata");

export const blobFileSchema = z
  .object({
    publicUrl: z.string().openapi({
      example: "https://store.public.blob.vercel-storage.com/users/user_123/document_abc.pdf",
      description: "Public URL of the uploaded file",
    }),
    metadata: blobFileMetadataSchema,
  })
  .openapi("BlobFile");

export const blobFilesSchema = z.array(blobFileSchema);

export type BlobFile = z.infer<typeof blobFileSchema>;
export type BlobFileMetadata = z.infer<typeof blobFileMetadataSchema>;
