import * as z from "zod";

export const jobShareCreatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});

export const jobShareRecipientOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
});

export const jobShareResponseSchema = z.object({
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  url: z.url(),
  creator: jobShareCreatorSchema,
  recipientOrganization: jobShareRecipientOrganizationSchema.nullable(),
});

export const jobShareRequestSchema = z.object({
  shareWithOrganization: z.boolean().optional(),
  allowSearchIndexing: z.boolean().optional(),
});

export const jobShareRemoveRequestSchema = z.object({
  removeAll: z.boolean().optional(),
  removeOrganizationShare: z.boolean().optional(),
});

export type JobShareRequest = z.infer<typeof jobShareRequestSchema>;
export type JobShareResponse = z.infer<typeof jobShareResponseSchema>;
export type JobShareRemoveRequest = z.infer<typeof jobShareRemoveRequestSchema>;
