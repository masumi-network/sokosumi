import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const organizationSchema = z.object({
  id: z.string().openapi({ example: "org_123" }),
  createdAt: dateTimeSchema,
  name: z.string().openapi({ example: "My Organization" }),
  slug: z.string().openapi({ example: "my-org" }),
  logo: z
    .httpUrl()
    .or(z.literal(""))
    .nullable()
    .openapi({ example: "https://example.com/logo.png" }),
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
