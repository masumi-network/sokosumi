import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const linkSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    jobId: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    url: z.string().openapi({ example: "https://example.com/article1" }),
    title: z.string().nullish().openapi({ example: "My Job" }),
  })
  .openapi("Link");

export const linksSchema = z.array(linkSchema);
