import { z } from "@hono/zod-openapi";

export const userSchema = z
  .object({
    id: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    name: z.string().openapi({ example: "John Doe" }),
    email: z.string().openapi({ example: "john.doe@example.com" }),
  })
  .openapi("User");
