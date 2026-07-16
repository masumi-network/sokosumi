import { z } from "@hono/zod-openapi";
import { BlobStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";
import { blobStatusSchema } from "@/schemas/domain-enums.schema";

export const fileSchema = z
  .object({
    id: z.string().openapi({
      example: "cmi4gmksz000104l8wps8p7fp",
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    jobId: z.string().openapi({
      example: "cmi4gmksz000104l8wps8p7fp",
      description: "ID of the job",
    }),
    sourceUrl: z.string().openapi({
      example: "https://example.com/file.pdf",
      description: "Source URL of the file",
    }),
    name: z
      .string()
      .nullish()
      .openapi({ example: "file.pdf", description: "Name of the file" }),
    status: blobStatusSchema.openapi({
      example: BlobStatus.READY,
      description: "Status of the file",
    }),
    size: z
      .number()
      .nullish()
      .openapi({ example: 1000, description: "Size in bytes" }),
    mimeType: z.string().nullish().openapi({
      example: "application/pdf",
      description: "MIME type of the file",
    }),
    fileUrl: z.string().nullish().openapi({
      example: "https://blob.vercel.app/file.pdf",
      description: "Publicly accessible URL of the file",
    }),
  })
  .openapi("File");

export const filesSchema = z.array(fileSchema);
