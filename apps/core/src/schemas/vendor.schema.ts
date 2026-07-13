import { z } from "@hono/zod-openapi";

const vendorLogoSchema = z.string().nullable();

const vendorLogosSchema = z
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
    createdAt: z.date(),
    updatedAt: z.date(),
    name: z.string().openapi({ example: "Serviceplan" }),
    slug: z.string().openapi({ example: "serviceplan" }),
    logos: vendorLogosSchema,
  })
  .openapi("Vendor");

export const createVendorRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).openapi({ example: "Serviceplan" }),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .openapi({ example: "serviceplan" }),
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
