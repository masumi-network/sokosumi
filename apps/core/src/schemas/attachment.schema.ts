import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const attachmentSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().openapi({
      example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
      description: "ID of the user",
    }),
    referenceId: z.string().openapi({
      example: "cmi4gmksz000104l8wps8p7fp",
      description: "ID of the reference",
    }),
    referenceType: z
      .enum(["Input", "Task", "Comment"])
      .openapi({ example: "Input", description: "Type of the reference" }),
    name: z
      .string()
      .nullish()
      .openapi({ example: "file.pdf", description: "Name of the file" }),
    size: z
      .number()
      .nullish()
      .openapi({ example: 1000, description: "Size in bytes" }),
    mimeType: z.string().nullish().openapi({
      example: "application/pdf",
      description: "MIME type of the file",
    }),
    url: z.string().nullish().openapi({
      example: "https://example.com/file.pdf",
      description: "Publicly accessible URL of the file",
    }),
  })
  .openapi("Attachment");

export const attachmentsSchema = z.array(attachmentSchema);
