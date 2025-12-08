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
      .nullable()
      .openapi({ example: "https://example.com/image.png" }),
    credits: z.number().openapi({ example: 100.0 }),
    marketingOptIn: z.boolean().openapi({ example: true }),
    notificationsOptIn: z.boolean().openapi({ example: true }),
    onboardingCompleted: z.boolean().openapi({ example: false }),
  })
  .openapi("User");

export type User = z.infer<typeof userSchema>;
