import * as z from "zod";

export const jobShareUserSchema = z.object({
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
  id: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  url: z.url(),
  user: jobShareUserSchema,
  recipientOrganization: jobShareRecipientOrganizationSchema.nullable(),
});

export const jobShareRequestSchema = z
  .object({
    scopes: z.array(z.enum(["organization", "public"])),
    allowSearchIndexing: z.boolean().optional(),
  })
  .refine((data) => data.scopes.length > 0, {
    message: "At least one scope is required",
    path: ["scopes"],
  });

export const jobShareRemoveRequestSchema = z
  .object({
    scopes: z.array(z.enum(["organization", "public"])),
  })
  .refine((data) => data.scopes.length > 0, {
    message: "At least one scope is required",
    path: ["scopes"],
  });

export type JobShareRequest = z.infer<typeof jobShareRequestSchema>;
export type JobShareResponse = z.infer<typeof jobShareResponseSchema>;
export type JobShareRemoveRequest = z.infer<typeof jobShareRemoveRequestSchema>;
