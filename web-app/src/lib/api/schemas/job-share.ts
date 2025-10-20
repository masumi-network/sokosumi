import * as z from "zod";

import { ShareAccessType } from "@/prisma/generated/client";

export const jobShareRequestSchema = z.object({
  accessType: z.enum(ShareAccessType),
  shareWithOrganization: z.boolean().optional(),
  allowSearchIndexing: z.boolean().optional(),
});

export const jobShareCreatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});

export const jobShareResponseSchema = z.object({
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  url: z.url(),
  creator: jobShareCreatorSchema,
});

export type JobShareRequest = z.infer<typeof jobShareRequestSchema>;
export type JobShareResponse = z.infer<typeof jobShareResponseSchema>;
