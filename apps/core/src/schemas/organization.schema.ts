import { z } from "@hono/zod-openapi";
import { sanitizeOrganizationLogoForApi } from "@sokosumi/utils";

import { dateTimeSchema } from "@/helpers/datetime";
import { memberRoleSchema } from "@/schemas/domain-enums.schema";

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
    role: memberRoleSchema,
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

export const organizationSummarySchema = z
  .object({
    id: z.string().openapi({ example: "org_123" }),
    name: z.string().openapi({ example: "Acme Labs" }),
    slug: z.string().openapi({ example: "acme-labs" }),
  })
  .openapi("OrganizationSummary");

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
