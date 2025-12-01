import { z } from "@hono/zod-openapi";
import { BlobOrigin, BlobStatus } from "@sokosumi/database";

export const fileSchema = z.object({
  id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
  createdAt: z
    .date()
    .openapi({ example: new Date("2021-01-01T00:00:00.000Z") }),
  updatedAt: z
    .date()
    .openapi({ example: new Date("2021-01-01T00:00:00.000Z") }),
  userId: z.string().openapi({ example: "user_123" }),
  name: z.string().nullish().openapi({ example: "My Job" }),
  origin: z.enum(BlobOrigin).openapi({ example: BlobOrigin.INPUT }),
  status: z.enum(BlobStatus).openapi({ example: BlobStatus.READY }),
  size: z.number().nullish().openapi({ example: 1000 }),
  mimeType: z.string().nullish().openapi({ example: "application/pdf" }),
  fileUrl: z
    .string()
    .nullish()
    .openapi({ example: "https://example.com/file.pdf" }),
  sourceUrl: z.string().openapi({ example: "https://example.com/file.pdf" }),
});
