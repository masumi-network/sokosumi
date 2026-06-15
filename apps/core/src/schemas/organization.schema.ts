import { z } from "@hono/zod-openapi";
import { sanitizeOrganizationLogoForApi } from "@sokosumi/utils";

import { dateTimeSchema } from "@/helpers/datetime";

const organizationLogoSchema = z.preprocess(
  (logo) => sanitizeOrganizationLogoForApi(logo),
  z.union([z.httpUrl(), z.literal(""), z.null()]),
);

export const organizationSchema = z.object({
  id: z.string().openapi({ example: "org_123" }),
  createdAt: dateTimeSchema,
  name: z.string().openapi({ example: "My Organization" }),
  slug: z.string().openapi({ example: "my-org" }),
  logo: organizationLogoSchema.openapi({
    example: "https://example.com/logo.png",
  }),
  metadata: z
    .object({
      url: z.httpUrl().nullable().optional(),
      invoiceEmail: z.string().nullable().optional(),
    })
    .catchall(z.unknown())
    .nullable()
    .openapi({ example: { url: "https://example.com" } }),
});

export type Organization = z.infer<typeof organizationSchema>;

export const organizationWithRoleSchema = organizationSchema
  .extend({
    role: z.string().openapi({ example: "member" }),
  })
  .openapi("Organization");

export type OrganizationWithRole = z.infer<typeof organizationWithRoleSchema>;

export const organizationsSchema = z.array(organizationWithRoleSchema);

/**
 * Raw organization record (no relations) with `metadata` kept as the stored
 * string column. Mirrors the Prisma `Organization` model so web callers can
 * keep consuming the database `Organization` type unchanged.
 */
export const organizationRecordSchema = z
  .object({
    id: z.string().openapi({ example: "org_123" }),
    name: z.string().openapi({ example: "My Organization" }),
    slug: z.string().openapi({ example: "my-org" }),
    logo: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/logo.png" }),
    metadata: z
      .string()
      .nullable()
      .openapi({ example: '{"url":"https://example.com"}' }),
    createdAt: dateTimeSchema,
    stripeCustomerId: z.string().nullable().openapi({ example: "cus_123" }),
  })
  .openapi("OrganizationRecord");

export type OrganizationRecord = z.infer<typeof organizationRecordSchema>;

/**
 * Request body for setting (or clearing) an organization's invoice email.
 * Pass a null `invoiceEmail` to clear it.
 */
export const organizationInvoiceEmailWriteSchema = z
  .object({
    invoiceEmail: z.email().nullable().openapi({
      example: "billing@acme.example",
      description: "Invoice email to set, or null to clear it",
    }),
  })
  .openapi("OrganizationInvoiceEmailWrite");

export type OrganizationInvoiceEmailWrite = z.infer<
  typeof organizationInvoiceEmailWriteSchema
>;

/**
 * The persisted invoice email of an organization, or `null` when none is
 * configured.
 */
export const organizationInvoiceEmailSchema = z
  .object({
    invoiceEmail: z.string().nullable().openapi({
      example: "billing@acme.example",
      description: "The persisted invoice email, or null when none",
    }),
  })
  .openapi("OrganizationInvoiceEmail");

export type OrganizationInvoiceEmail = z.infer<
  typeof organizationInvoiceEmailSchema
>;

export const organizationSummarySchema = z
  .object({
    id: z.string().openapi({ example: "org_123" }),
    name: z.string().openapi({ example: "Acme Labs" }),
    slug: z.string().openapi({ example: "acme-labs" }),
  })
  .openapi("OrganizationSummary");

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
