import { z } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";
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

export const userFilesQuerySchema = z
  .object({
    cursor: z.string().optional().openapi({
      param: { name: "cursor", in: "query" },
      description: "Cursor from the previous response page",
      example: "users/user_123/document_abc.pdf",
    }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.MAX_PAGINATION_LIMIT)
      .default(LIMITS.USER_FILES_DEFAULT_PAGINATION_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Maximum number of files to return (default ${LIMITS.USER_FILES_DEFAULT_PAGINATION_LIMIT}, max ${LIMITS.MAX_PAGINATION_LIMIT})`,
        example: LIMITS.USER_FILES_DEFAULT_PAGINATION_LIMIT,
      }),
  })
  .openapi("UserFilesQuery");

export const userFilesPaginationMetaSchema = z
  .object({
    cursor: z.string().nullable().openapi({
      example: null,
      description: "Cursor used for the current page",
    }),
    limit: z.number().int().min(1).openapi({
      example: 10,
      description: "Maximum number of items requested",
    }),
    hasMore: z.boolean().openapi({
      example: true,
      description: "Whether another page is available",
    }),
    nextCursor: z.string().nullable().openapi({
      example: "cursor_abc123",
      description: "Cursor for the next page",
    }),
  })
  .openapi("UserFilesPaginationMetadata");

export const userFilesPaginatedResponseSchema = z
  .object({
    data: userFilesSchema,
    meta: z.object({
      timestamp: dateTimeSchema,
      requestId: z
        .string()
        .openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
      pagination: userFilesPaginationMetaSchema,
    }),
  })
  .openapi("UserFilesPaginatedResponse");

export type UserFile = z.infer<typeof userFileSchema>;
export type UserFileMetadata = z.infer<typeof userFileMetadataSchema>;
