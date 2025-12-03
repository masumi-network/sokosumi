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
  .refine(
    (data) => {
      // If origin is OUTPUT, sourceUrl must be present
      if (data.origin === BlobOrigin.OUTPUT) {
        return data.sourceUrl != null && data.sourceUrl !== "";
      }
      return true;
    },
    {
      message: "sourceUrl is required when origin is OUTPUT",
      path: ["sourceUrl"],
    },
  )
  .refine(
    (data) => {
      // If origin is INPUT, fileUrl must be present
      if (data.origin === BlobOrigin.INPUT) {
        return data.fileUrl != null && data.fileUrl !== "";
      }
      return true;
    },
    {
      message: "fileUrl is required when origin is INPUT",
      path: ["fileUrl"],
    },
  )
  .openapi("File");

export const filesSchema = z.array(fileSchema);
