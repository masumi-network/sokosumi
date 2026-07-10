import { z } from "@hono/zod-openapi";
import { VendorGrantScope, VendorGrantStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";
import { workspaceSummarySchema } from "@/schemas/workspace.schema";

const vendorLogoSchema = z.string().nullable();

export const vendorLogosSchema = z
  .object({
    light: vendorLogoSchema.openapi({
      example: "/images/logos/serviceplan-logo.png",
    }),
    dark: vendorLogoSchema.openapi({
      example: "/images/logos/serviceplan-logo-white.png",
    }),
  })
  .openapi("VendorLogos");

export const vendorLogosInputSchema = z
  .object({
    light: vendorLogoSchema.optional(),
    dark: vendorLogoSchema.optional(),
  })
  .openapi("VendorLogosInput");

export const vendorSchema = z
  .object({
    id: z.string().openapi({ example: "01960001-0001-7001-8001-000000000001" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    name: z.string().openapi({ example: "Service Plan" }),
    slug: z.string().openapi({ example: "service-plan" }),
    logos: vendorLogosSchema,
  })
  .openapi("Vendor");

export const vendorGrantSchema = z
  .object({
    id: z.string().openapi({ example: "vgr_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    scope: z
      .enum(VendorGrantScope)
      .openapi({ example: VendorGrantScope.VENDOR }),
    status: z
      .enum(VendorGrantStatus)
      .openapi({ example: VendorGrantStatus.PENDING }),
    vendorId: z
      .string()
      .openapi({ example: "01960001-0001-7001-8001-000000000001" }),
    vendor: vendorSchema,
    userId: z.string().openapi({ example: "user_123" }),
    workspaceId: z.string().uuid().openapi({
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
    workspace: workspaceSummarySchema,
    resolvedAt: dateTimeSchema.nullable(),
    awaitingVendorApprovalTaskCount: z
      .number()
      .int()
      .nonnegative()
      .openapi({ example: 1 }),
  })
  .openapi("VendorGrant");

export const vendorGrantListSchema = z
  .array(vendorGrantSchema)
  .openapi("VendorGrantList");

export const createVendorRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .openapi({ example: "Service Plan" }),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .openapi({ example: "service-plan" }),
    logos: vendorLogosInputSchema.optional(),
  })
  .openapi("CreateVendorRequest");

export const patchVendorRequestSchema = z
  .object({
    name: createVendorRequestSchema.shape.name.optional(),
    slug: createVendorRequestSchema.shape.slug.optional(),
    logos: vendorLogosInputSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one vendor field is required",
  })
  .openapi("PatchVendorRequest");
