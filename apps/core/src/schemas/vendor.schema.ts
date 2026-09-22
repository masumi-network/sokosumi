import { z } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";

const vendorLogoSchema = z
  .string()
  .max(LIMITS.VENDOR_LOGO_MAX_LENGTH)
  .nullable();

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

export const adminVendorSchema = vendorSchema
  .extend({
    listed: z.boolean().openapi({
      description: "Whether this vendor appears in GET /v1/vendors.",
    }),
  })
  .openapi("AdminVendor");

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
    listed: z.boolean().optional().openapi({
      description:
        "Whether this vendor appears in GET /v1/vendors. Platform admin only.",
    }),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one vendor field is required",
  })
  .openapi("PatchVendorRequest");

export const vendorMemberRoleSchema = z
  .enum(["admin", "developer"])
  .openapi("VendorMemberRole");

export const vendorMembershipSchema = vendorSchema
  .extend({
    role: vendorMemberRoleSchema,
  })
  .openapi("VendorMembership");

export const vendorMemberSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    email: z.string().email().openapi({ example: "dev@example.com" }),
    name: z.string().nullable().openapi({ example: "Dev User" }),
    role: vendorMemberRoleSchema,
  })
  .openapi("VendorMember");

export const vendorMemberInviteStatusSchema = z
  .enum(["PENDING", "ACCEPTED", "DECLINED", "REVOKED", "EXPIRED"])
  .openapi("VendorMemberInviteStatus");

export const createVendorMemberInviteRequestSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(320)
      .openapi({ example: "dev@example.com" }),
    role: vendorMemberRoleSchema.default("developer").openapi({
      description:
        "Role granted on accept. Defaults to developer when omitted.",
      example: "developer",
    }),
  })
  .openapi("CreateVendorMemberInviteRequest");

export const vendorMemberInviteSchema = z
  .object({
    id: z.string().openapi({ example: "01960001-0001-7001-8001-000000000001" }),
    vendorId: z
      .string()
      .openapi({ example: "01960001-0001-7001-8001-000000000002" }),
    email: z.string().email().openapi({ example: "dev@example.com" }),
    role: vendorMemberRoleSchema,
    status: vendorMemberInviteStatusSchema,
    expiresAt: z.date(),
    createdAt: z.date(),
  })
  .openapi("VendorMemberInvite");

export const myVendorInviteSchema = z
  .object({
    id: z.string().openapi({ example: "01960001-0001-7001-8001-000000000001" }),
    role: vendorMemberRoleSchema,
    status: vendorMemberInviteStatusSchema,
    expiresAt: z.date(),
    createdAt: z.date(),
    vendor: vendorSchema,
  })
  .openapi("MyVendorInvite");

export const patchVendorMemberRoleRequestSchema = z
  .object({
    role: vendorMemberRoleSchema,
  })
  .openapi("PatchVendorMemberRoleRequest");

export const patchVendorAdminRequestSchema = z
  .object({
    name: createVendorRequestSchema.shape.name.optional(),
    logos: vendorLogosInputSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one vendor field is required",
  })
  .openapi("PatchVendorAdminRequest");

export const assignCoworkerRequestSchema = z
  .object({
    userId: z.string().min(1).openapi({ example: "user_123" }),
  })
  .openapi("AssignCoworkerRequest");

export const coworkerAssignmentSchema = z
  .object({
    coworkerId: z.string().openapi({ example: "cow_123" }),
    userId: z.string().openapi({ example: "user_123" }),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .openapi("CoworkerAssignment");
