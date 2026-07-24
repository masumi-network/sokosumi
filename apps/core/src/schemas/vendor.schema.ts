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

function exactlyOneUserIdentity(data: {
  userId?: string;
  email?: string;
}): boolean {
  return (data.userId !== undefined) !== (data.email !== undefined);
}

const userIdentityFields = {
  userId: z.string().min(1).optional().openapi({ example: "user_123" }),
  email: z.string().email().optional().openapi({ example: "dev@example.com" }),
};

export const addVendorMemberRequestSchema = z
  .object({
    ...userIdentityFields,
    role: vendorMemberRoleSchema.default("developer").openapi({
      description: "Member role. Defaults to developer when omitted.",
      example: "developer",
    }),
  })
  .refine(exactlyOneUserIdentity, {
    message: "Provide exactly one of userId or email",
  })
  .openapi("AddVendorMemberRequest");

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
  .object(userIdentityFields)
  .refine(exactlyOneUserIdentity, {
    message: "Provide exactly one of userId or email",
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
