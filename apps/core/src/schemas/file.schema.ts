import { z } from "@hono/zod-openapi";
import { BlobOrigin, BlobStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const fileSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    jobId: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    name: z.string().nullish().openapi({ example: "My Job" }),
    origin: z
      .enum(BlobOrigin)
      .openapi({ example: BlobOrigin.INPUT, enum: Object.values(BlobOrigin) }),
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
      .nullish()
      .openapi({ example: "https://example.com/file.pdf" }),
  })
  .openapi("File");
export type File = z.infer<typeof fileSchema>;

export const filesSchema = z.array(fileSchema);
export type Files = z.infer<typeof filesSchema>;
