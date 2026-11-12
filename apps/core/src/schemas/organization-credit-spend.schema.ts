import { z } from "@hono/zod-openapi";

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

export const organizationCreditSpendSchema = z
  .object({
    month: monthSchema.openapi({
      description: "Current UTC calendar month, as YYYY-MM",
      example: "2026-11",
    }),
    previousMonth: monthSchema.openapi({
      description: "Previous UTC calendar month, as YYYY-MM",
      example: "2026-10",
    }),
    rows: z
      .array(
        z.object({
          userId: z.string().nullable().openapi({
            description:
              "User the credits were billed to. Null for organization charges billed to no person.",
            example: "user_123",
          }),
          name: z.string().nullable().openapi({
            description: "Display name of the billed user",
            example: "Jane Doe",
          }),
          image: z.string().nullable().openapi({
            description: "Avatar of the billed user",
            example: null,
          }),
          isMember: z.boolean().openapi({
            description:
              "Whether the billed user is a member of the organization today. False for former members and for the no-person row.",
            example: true,
          }),
          credits: z.number().openapi({
            description:
              "Credits spent this month, before refunds. Top ups are not spend.",
            example: 12.5,
          }),
          previousCredits: z.number().openapi({
            description: "Credits spent last month, before refunds",
            example: 3,
          }),
        }),
      )
      .openapi({
        description:
          "One row per current member (zero when they spent nothing), plus former members and the no-person row when they spent in either month. Highest spend this month first.",
      }),
  })
  .openapi("OrganizationCreditSpend");
