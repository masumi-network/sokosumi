import { z } from "@hono/zod-openapi";
import {
  isOrganizationLogoAllowedContentType,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
} from "@sokosumi/utils";

import { blobUploadGrantSchema } from "@/schemas/blob-upload-grant.schema";

export const createVendorLogoUploadRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(512).openapi({
      example: "logo.png",
      description: "Original file name supplied by the client",
    }),
    contentType: z.string().trim().min(1).max(255).openapi({
      example: "image/png",
      description: "Declared logo MIME type from the client",
    }),
    size: z
      .number()
      .int()
      .positive()
      .max(
        ORGANIZATION_LOGO_MAX_SIZE_BYTES,
        `File exceeds maximum size of ${ORGANIZATION_LOGO_MAX_SIZE_BYTES} bytes`,
      )
      .openapi({
        example: 48_000,
        description: "File size in bytes",
      }),
    maxSizeBytes: z
      .number()
      .int()
      .positive()
      .max(ORGANIZATION_LOGO_MAX_SIZE_BYTES)
      .optional()
      .openapi({
        example: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
        description:
          "Optional per-upload size ceiling in bytes. Must not exceed the organization logo maximum.",
      }),
  })
  .superRefine((data, ctx) => {
    if (data.maxSizeBytes !== undefined && data.size > data.maxSizeBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `File exceeds maximum size of ${data.maxSizeBytes} bytes`,
        path: ["size"],
      });
    }

    if (!isOrganizationLogoAllowedContentType(data.contentType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported content type: "${data.contentType}"`,
        path: ["contentType"],
      });
    }
  })
  .openapi("CreateVendorLogoUploadRequest");

/** Same grant shape as other direct-upload mints; named for vendor logos. */
export const vendorLogoUploadSessionSchema = blobUploadGrantSchema.openapi(
  "VendorLogoUploadSession",
);

export type VendorLogoUploadSession = z.infer<
  typeof vendorLogoUploadSessionSchema
>;

export const vendorLogoCleanupRequestSchema = z
  .object({
    url: z.string().url().openapi({
      example:
        "https://abc.public.blob.vercel-storage.com/vendors/vendor_123/logos/logo.png",
      description: "Public blob URL of a prior vendor logo to delete if owned",
    }),
  })
  .openapi("VendorLogoCleanupRequest");
