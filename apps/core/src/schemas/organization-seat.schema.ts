import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

/**
 * Seat usage summary for an organization.
 *
 * Mirrors the resolved billing plan: seat entitlements only exist for paid
 * plans, so `assignedCount` and `unusedSeats` are reported as `0` when the
 * organization is on the free plan (`paidPlan` is `null`).
 */
export const organizationSeatSummarySchema = z
  .object({
    assignedCount: z.number().int().openapi({
      description:
        "Number of members with an assigned seat (0 when the organization has no paid plan)",
      example: 2,
    }),
    memberCount: z.number().int().openapi({
      description: "Total number of organization members",
      example: 5,
    }),
    isEnterpriseContract: z.boolean().openapi({
      description:
        "Whether the organization is billed via an active enterprise contract",
      example: false,
    }),
    paidPlan: z
      .enum(["starter", "standard", "pro", "enterprise"])
      .nullable()
      .openapi({
        description:
          "Resolved paid billing plan name (null when the organization is on the free plan)",
        example: "starter",
      }),
    purchasedSeats: z.number().int().openapi({
      description: "Number of purchased seats",
      example: 3,
    }),
    unusedSeats: z.number().int().openapi({
      description:
        "Purchased seats without an assigned member (0 when the organization has no paid plan)",
      example: 1,
    }),
  })
  .openapi("OrganizationSeatSummary");

export type OrganizationSeatSummaryApi = z.infer<
  typeof organizationSeatSummarySchema
>;

export const organizationSeatAssignmentSchema = z
  .object({
    memberId: z.string().openapi({
      description: "ID of the member the seat was assigned to",
      example: "member_123",
    }),
    seatAssignedAt: dateTimeSchema.openapi({
      description: "When the seat was assigned",
    }),
  })
  .openapi("OrganizationSeatAssignment");

export const organizationSeatUnassignmentSchema = z
  .object({
    memberId: z.string().openapi({
      description: "ID of the member the seat was unassigned from",
      example: "member_123",
    }),
  })
  .openapi("OrganizationSeatUnassignment");
