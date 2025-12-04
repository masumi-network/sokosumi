import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const linkSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    jobId: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    url: z.url().openapi({ example: "https://example.com/file.pdf" }),
    title: z.string().nullish().openapi({ example: "My Job" }),
  })
  .openapi("Link");

export const linksSchema = z.array(linkSchema);
