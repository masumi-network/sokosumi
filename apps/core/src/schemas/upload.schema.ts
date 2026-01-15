import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const uploadSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    referenceId: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    referenceType: z
      .enum(["Input", "Task", "Comment"])
      .openapi({ example: "Input" }),
    name: z.string().nullish().openapi({ example: "My Job" }),
    size: z.number().nullish().openapi({ example: 1000 }),
    mimeType: z.string().nullish().openapi({ example: "application/pdf" }),
    url: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/file.pdf" }),
  })
  .openapi("Upload");

export const uploadsSchema = z.array(uploadSchema);
