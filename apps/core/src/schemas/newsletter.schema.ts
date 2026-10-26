import { z } from "@hono/zod-openapi";
import {
  NewsletterIssueStatus,
  NewsletterSubscriberSource,
  NewsletterSubscriberStatus,
} from "@sokosumi/database";
import { newsletterContentSchema } from "@sokosumi/utils";

import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

export const newsletterProjectParamsSchema = z.object({ id: z.uuid() });
export const newsletterSubscriberParamsSchema =
  newsletterProjectParamsSchema.extend({ subscriberId: z.uuid() });
export const newsletterIssueParamsSchema = newsletterProjectParamsSchema.extend(
  { issueId: z.uuid() },
);

// Shared schemas may load before Hono extends Zod with OpenAPI methods.
const contentSchema = newsletterContentSchema
  .clone()
  .openapi("NewsletterContent");

export const newsletterTemplateSchema = z
  .enum(["TEXT", "IMAGES", "BUTTONS"])
  .openapi("NewsletterTemplate");

export const newsletterIssueStatusSchema = z
  .enum(NewsletterIssueStatus)
  .openapi("NewsletterIssueStatus");

export const createNewsletterIssueRequestSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    previewText: z.string().max(500).nullable().optional(),
    template: newsletterTemplateSchema,
    content: contentSchema,
  })
  .openapi("CreateNewsletterIssueRequest");

export const patchNewsletterIssueRequestSchema =
  createNewsletterIssueRequestSchema
    .partial()
    .extend({ revision: z.int().nonnegative() })
    .refine(
      ({ revision: _revision, ...input }) =>
        Object.values(input).some((value) => value !== undefined),
      { message: "Provide issue content to update" },
    )
    .openapi("PatchNewsletterIssueRequest");

export const newsletterIssueSchema = z
  .object({
    id: z.uuid(),
    newsletterId: z.uuid(),
    projectId: z.uuid(),
    workspaceId: z.uuid(),
    subject: z.string(),
    previewText: z.string().nullable(),
    template: newsletterTemplateSchema,
    content: contentSchema,
    status: newsletterIssueStatusSchema,
    publicSlug: z.string(),
    revision: z.int().nonnegative(),
    scheduledAt: dateTimeSchema.nullable(),
    timezone: z.string().nullable(),
    sentAt: dateTimeSchema.nullable(),
    approvedByUserId: z.string().nullable(),
    approvedAt: dateTimeSchema.nullable(),
    taskId: z.string().nullable(),
    lastError: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("NewsletterIssue");

export const listNewsletterIssuesQuerySchema =
  cursorPaginationQuerySchema.extend({
    cursor: z.uuid().optional(),
    status: newsletterIssueStatusSchema.optional(),
  });

export type CreateNewsletterIssueRequest = z.infer<
  typeof createNewsletterIssueRequestSchema
>;
export type PatchNewsletterIssueRequest = z.infer<
  typeof patchNewsletterIssueRequestSchema
>;
export type ListNewsletterIssuesQuery = z.infer<
  typeof listNewsletterIssuesQuerySchema
>;

export const newsletterEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

const brandColorSchema = z.string().regex(/^#(?:[\da-f]{3}|[\da-f]{6})$/i);

export const newsletterBrandSchema = z
  .object({
    logoUrl: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      .optional(),
    primaryColor: brandColorSchema.optional(),
    accentColor: brandColorSchema.optional(),
    fontFamily: z.string().trim().min(1).max(200).optional(),
    footerText: z.string().max(5000).optional(),
  })
  .openapi("NewsletterBrand");

export const putNewsletterRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    senderName: z.string().trim().min(1).max(200),
    replyTo: newsletterEmailSchema,
    brand: newsletterBrandSchema,
    welcomeEmailEnabled: z.boolean(),
    welcomeSubject: z.string().max(200).nullable().optional(),
    welcomeBody: z.string().max(100_000).nullable().optional(),
  })
  .openapi("PutNewsletterRequest");

export const newsletterSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    workspaceId: z.uuid(),
    name: z.string(),
    senderName: z.string(),
    replyTo: z.email(),
    brand: newsletterBrandSchema,
    welcomeEmailEnabled: z.boolean(),
    welcomeSubject: z.string().nullable(),
    welcomeBody: z.string().nullable(),
    publicSlug: z.string(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("Newsletter");

export const newsletterSubscriberStatusSchema = z
  .enum(NewsletterSubscriberStatus)
  .openapi("NewsletterSubscriberStatus");

export const newsletterSubscriberSchema = z
  .object({
    id: z.uuid(),
    newsletterId: z.uuid(),
    email: z.email(),
    name: z.string().nullable(),
    status: newsletterSubscriberStatusSchema,
    source: z
      .enum(NewsletterSubscriberSource)
      .openapi("NewsletterSubscriberSource"),
    consentAt: dateTimeSchema.nullable(),
    confirmedAt: dateTimeSchema.nullable(),
    unsubscribedAt: dateTimeSchema.nullable(),
    bouncedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
  })
  .openapi("NewsletterSubscriber");

export const listNewsletterSubscribersQuerySchema =
  cursorPaginationQuerySchema.extend({
    cursor: z.uuid().optional(),
    status: newsletterSubscriberStatusSchema.optional(),
    search: z.string().trim().min(1).max(254).optional(),
  });

export const newsletterSubscriberListSchema = z
  .object({
    subscribers: z.array(newsletterSubscriberSchema),
    counts: z.object({
      PENDING: z.int().nonnegative(),
      ACTIVE: z.int().nonnegative(),
      UNSUBSCRIBED: z.int().nonnegative(),
      BOUNCED: z.int().nonnegative(),
    }),
  })
  .openapi("NewsletterSubscriberList");

export const addNewsletterSubscriberRequestSchema = z
  .object({
    email: newsletterEmailSchema,
    name: z.string().trim().max(200).nullable().optional(),
    consent: z.literal(true),
  })
  .openapi("AddNewsletterSubscriberRequest");

export const patchNewsletterSubscriberRequestSchema = z
  .object({
    name: z.string().trim().max(200).nullable().optional(),
    status: z.enum(["ACTIVE", "UNSUBSCRIBED"]).optional(),
  })
  .refine((input) => input.name !== undefined || input.status !== undefined, {
    message: "Provide a name or status",
  })
  .openapi("PatchNewsletterSubscriberRequest");

export const importNewsletterSubscribersRequestSchema = z
  .object({
    csv: z
      .string()
      .max(5_000_000)
      .refine((csv) => Buffer.byteLength(csv, "utf8") <= 5_000_000, {
        message: "CSV exceeds 5 MB",
      }),
    consent: z.literal(true),
  })
  .openapi("ImportNewsletterSubscribersRequest");

export const newsletterImportResultSchema = z
  .object({
    imported: z.int().nonnegative(),
    skippedExisting: z.int().nonnegative().openapi({
      description:
        "Valid rows skipped because the email already exists in the newsletter or CSV.",
    }),
    invalid: z
      .array(z.object({ row: z.int().min(2), value: z.string() }))
      .max(100),
  })
  .openapi("NewsletterImportResult");

export type PutNewsletterRequest = z.infer<typeof putNewsletterRequestSchema>;
export type ListNewsletterSubscribersQuery = z.infer<
  typeof listNewsletterSubscribersQuerySchema
>;
export type AddNewsletterSubscriberRequest = z.infer<
  typeof addNewsletterSubscriberRequestSchema
>;
export type PatchNewsletterSubscriberRequest = z.infer<
  typeof patchNewsletterSubscriberRequestSchema
>;
