import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const userSchema = z
  .object({
    id: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    name: z.string().openapi({ example: "John Doe" }),
    email: z.email().openapi({ example: "john.doe@example.com" }),
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/image.png" }),
    credits: z.number().openapi({ example: 100.0 }),
  })
  .openapi("User");

export type User = z.infer<typeof userSchema>;

export const userPreferencesResponseSchema = z
  .object({
    marketingOptIn: z.boolean().openapi({
      description: "Whether the user wants to receive marketing emails",
      example: true,
    }),
    notificationsOptIn: z.boolean().openapi({
      description: "Whether the user wants to receive job status notifications",
      example: true,
    }),
  })
  .openapi("UserPreferences");

export const userOnboardingResponseSchema = z
  .object({
    completed: z.boolean().openapi({
      description: "Whether the user has completed onboarding",
      example: true,
    }),
  })
  .openapi("UserOnboarding");
