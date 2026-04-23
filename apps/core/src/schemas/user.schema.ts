import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { subscriptionSchema } from "@/schemas/subscription.schema";

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
  credits: z.object({
    subscription: subscriptionSchema.nullable(),
    extra: z.object({
      available: z.number().openapi({
        description: "Current available non-subscription credit balance",
        example: 12.5,
      }),
      total: z.number().openapi({
        description: "Current total active non-subscription credit pool",
        example: 30,
      }),
    }),
    buffer: z.number().openapi({
      description: "Current available non-subscription credit balance",
      example: 25.0,
    }),
    total: z.number().openapi({
      description:
        "Current available total credit balance (buffer plus remaining subscription credits)",
      example: 82.5,
    }),
  }),
});
