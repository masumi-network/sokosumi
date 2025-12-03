import { z } from "@hono/zod-openapi";

export const linkSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    createdAt: z
      .date()
      .openapi({ example: new Date("2021-01-01T00:00:00.000Z") }),
    updatedAt: z
      .date()
      .openapi({ example: new Date("2021-01-01T00:00:00.000Z") }),
    userId: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    jobId: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    url: z.url().openapi({ example: "https://example.com/file.pdf" }),
    title: z.string().nullish().openapi({ example: "My Job" }),
  })
  .openapi("Link");
export type Link = z.infer<typeof linkSchema>;

export const linksSchema = z.array(linkSchema);
export type Links = z.infer<typeof linksSchema>;
