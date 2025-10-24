import * as z from "zod";

export const jobPublicShareResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  url: z.url(),
  allowSearchIndexing: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const jobOrganizationShareResponseSchema = z.object({
  jobId: z.string(),
  organizationId: z.string(),
});

export const sharePostRequestSchema = z.object({
  allowSearchIndexing: z.boolean().default(true),
});

export type SharePostRequest = z.infer<typeof sharePostRequestSchema>;
export type JobPublicShareResponse = z.infer<
  typeof jobPublicShareResponseSchema
>;
export type JobOrganizationShareResponse = z.infer<
  typeof jobOrganizationShareResponseSchema
>;
