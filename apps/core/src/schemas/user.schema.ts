import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

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

export const createUserRequestSchema = z.object({
  name: z.string().min(1).openapi({
    description: "User's full name",
    example: "John Doe",
  }),
  email: z.email().openapi({
    description: "User's email address (must be a valid email address)",
    example: "john.doe@example.com",
  }),
  password: z.string().min(8).max(256).openapi({
    description: "User's password (must be between 8 and 256 characters)",
    example: "SecurePassword123!",
  }),
  termsAccepted: z
    .boolean()
    .refine((val) => val === true, {
      message: "Terms of service must be accepted",
    })
    .openapi({
      description: "Whether the user has accepted the terms of service",
      example: true,
    }),
  marketingOptIn: z.boolean().optional().default(false).openapi({
    description:
      "Whether the user wants to receive marketing emails (defaults to false)",
    example: false,
  }),
});

export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;
