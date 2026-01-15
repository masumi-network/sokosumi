import { z } from "@hono/zod-openapi";
import { BlobStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const fileSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    jobId: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    name: z.string().nullish().openapi({ example: "My Job" }),
    status: z
      .enum(BlobStatus)
      .openapi({ example: BlobStatus.READY, enum: Object.values(BlobStatus) }),
    size: z.number().nullish().openapi({ example: 1000 }),
    mimeType: z.string().nullish().openapi({ example: "application/pdf" }),
    fileUrl: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/file.pdf" }),
    sourceUrl: z
      .string()
      .openapi({ example: "https://example.com/file.pdf" }),
  })
  .openapi("File");

export const filesSchema = z.array(fileSchema);
