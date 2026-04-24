import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { subscriptionSchema } from "@/schemas/subscription.schema";

const creditBucketBreakdownItemSchema = z
  .object({
    total: z.number().openapi({
      description: "Original bucket amount in credits",
      example: 50,
    }),
    remaining: z.number().openapi({
      description:
        "Remaining balance in this bucket after prior consumption (same order as debits)",
      example: 32.5,
    }),
    expiresAt: dateTimeSchema.nullable().openapi({
      description: "When this bucket expires; null if it does not expire",
      example: "2026-07-01T00:00:00.000Z",
    }),
  })
  .openapi("CreditBucketBreakdown");

/** Nested shape mirrored under deprecated `credits` */
const creditsDeprecatedMirrorSchema = z.object({
  subscription: subscriptionSchema.nullable(),
  buffer: z.number().openapi({
    description: "Current available non-subscription credit balance",
    example: 25.0,
  }),
  total: z.number().openapi({
    description:
      "Current available total credit balance (buffer plus remaining subscription credits)",
    example: 82.5,
  }),
});

export const userSchema = z
  .object({
    id: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    name: z.string().openapi({ example: "John Doe" }),
    email: z.email().openapi({ example: "john.doe@example.com" }),
    emailVerified: z.boolean().openapi({ example: true }),
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/image.png" }),
    role: z.string().openapi({ example: "user" }),
  })
  .openapi("User");

export const userSummarySchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/avatar.png" }),
  })
  .openapi("UserSummary");

export type User = z.infer<typeof userSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;

export const userPreferencesResponseSchema = z.object({
  marketingOptIn: z.boolean().openapi({
    description: "Whether the user wants to receive marketing emails",
    example: true,
  }),
  notificationsOptIn: z.boolean().openapi({
    description: "Whether the user wants to receive job status notifications",
    example: true,
  }),
});

export const userOnboardingResponseSchema = z.object({
  completed: z.boolean().openapi({
    description: "Whether the user has completed onboarding",
    example: true,
  }),
});

export const creditsResponseSchema = z.object({
  subscription: subscriptionSchema.nullable().openapi({
    description:
      "Active subscription and period credit breakdown for the billing context",
  }),
  available: z.number().openapi({
    description:
      "Current available total credit balance (buffer plus remaining subscription credits)",
    example: 82.5,
  }),
  buckets: z.array(creditBucketBreakdownItemSchema).openapi({
    description:
      "Unexpired buckets with remaining balance, in consumption order: earliest expiresAt (non-expiring last), then smallest original allocation, then oldest createdAt, then id",
  }),
  credits: creditsDeprecatedMirrorSchema.openapi({
    deprecated: true,
    description:
      "Deprecated: prefer top-level `subscription` and `available`. Still includes `buffer` for non-subscription balance; `subscription` and `total` mirror the canonical fields for backward compatibility (`total` here matches top-level `available`).",
  }),
});
