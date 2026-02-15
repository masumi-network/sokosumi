import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { subscriptionSchema } from "@/schemas/subscription.schema";

export const organizationSchema = z.object({
  id: z.string().openapi({ example: "org_123" }),
  createdAt: dateTimeSchema,
  name: z.string().openapi({ example: "My Organization" }),
  slug: z.string().openapi({ example: "my-org" }),
});

export type Organization = z.infer<typeof organizationSchema>;

export const organizationWithRoleSchema = organizationSchema
  .extend({
    role: z.string().openapi({ example: "member" }),
    credits: z.number().openapi({
      description: "Current credit balance for the organization",
      example: 100.0,
    }),
    subscription: subscriptionSchema.nullable(),
  })
  .openapi("Organization");

export type OrganizationWithRole = z.infer<typeof organizationWithRoleSchema>;

export const organizationsSchema = z.array(organizationWithRoleSchema);
