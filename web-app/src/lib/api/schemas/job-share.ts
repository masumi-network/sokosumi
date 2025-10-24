import * as z from "zod";

export const jobShareResponseSchema = z
  .object({
    id: z.string(),
    jobId: z.string(),
    organizationId: z.string().nullable(),
    url: z.url().nullable(),
    allowSearchIndexing: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine(
    (data) => {
      if (data.organizationId) {
        return data.url !== null;
      }
      return data.url === null;
    },
    {
      message: "url is required if organizationId is not provided",
    },
  );

export const jobShareRequestSchema = z.object({
  scope: z.enum(["public", "organization"]).array().min(1).max(2),
  allowSearchIndexing: z.boolean().default(true),
});

export type JobShareRequest = z.infer<typeof jobShareRequestSchema>;
export type JobShareResponse = z.infer<typeof jobShareResponseSchema>;
