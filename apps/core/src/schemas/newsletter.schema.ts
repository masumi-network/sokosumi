import { z } from "@hono/zod-openapi";
import {
  NewsletterIssueStatus,
  NewsletterSubscriberSource,
  NewsletterSubscriberStatus,
} from "@sokosumi/database";
import {
  newsletterContentSchema,
  newsletterDraftInputSchema,
} from "@sokosumi/utils";

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

export const draftNewsletterIssueRequestSchema = newsletterDraftInputSchema
  .clone()
  .openapi("DraftNewsletterIssueRequest");

export type DraftNewsletterIssueRequest = z.infer<
  typeof draftNewsletterIssueRequestSchema
>;

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

export const newsletterIssueRevisionRequestSchema = z
  .object({ revision: z.int().nonnegative() })
  .openapi("NewsletterIssueRevisionRequest");

export const scheduleNewsletterIssueRequestSchema =
  newsletterIssueRevisionRequestSchema
    .extend({
      scheduledAt: z.iso.datetime(),
      timezone: z
        .string()
        .min(1)
        .max(100)
        .refine((timezone) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: timezone });
            return true;
          } catch {
            return false;
          }
        }, "Use a valid IANA time zone"),
    })
    .openapi("ScheduleNewsletterIssueRequest");

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
    approvedByName: z.string().nullable().optional(),
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
    contactListId: z.uuid().nullable(),
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

export const publicNewsletterParamsSchema = z.object({
  publicSlug: z.string().min(1).max(300),
});

export const publicNewsletterSchema = newsletterSchema
  .pick({ name: true, senderName: true, brand: true })
  .openapi("PublicNewsletter");

export const publicNewsletterIssueParamsSchema =
  publicNewsletterParamsSchema.extend({
    issueSlug: z.string().min(1).max(300),
  });

export const listPublicNewsletterIssuesQuerySchema =
  listNewsletterIssuesQuerySchema.omit({ status: true });

export const publicNewsletterIssueSummarySchema = z
  .object({
    publicSlug: z.string(),
    subject: z.string(),
    previewText: z.string().nullable(),
    sentAt: dateTimeSchema,
  })
  .openapi("PublicNewsletterIssueSummary");

export const publicNewsletterIssueSchema = publicNewsletterIssueSummarySchema
  .omit({ publicSlug: true })
  .extend({ html: z.string() })
  .openapi("PublicNewsletterIssue");

export const subscribeNewsletterRequestSchema = z
  .object({
    email: newsletterEmailSchema,
    name: z.string().trim().max(200).optional(),
    source: z.literal("SIGNUP_FORM").optional(),
    website: z.string().max(2048).optional(),
    locale: z.enum(["en", "de", "es"]).default("en"),
  })
  .openapi("SubscribeNewsletterRequest");

export const newsletterSignupAcceptedSchema = z
  .object({ status: z.literal("check_your_inbox") })
  .openapi("NewsletterSignupAccepted");

export const newsletterConfirmQuerySchema = z.object({
  token: z.string().min(1).max(512),
});

export type SubscribeNewsletterRequest = z.infer<
  typeof subscribeNewsletterRequestSchema
>;

export const newsletterSubscriberStatusSchema = z
  .enum(NewsletterSubscriberStatus)
  .openapi("NewsletterSubscriberStatus");

export const newsletterSubscriberSchema = z
  .object({
    id: z.uuid(),
    newsletterId: z.uuid(),
    email: z.email(),
    name: z.string().nullable(),
    contact: z.union([z.object({ id: z.uuid(), name: z.string() }), z.null()]),
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

export const newsletterConsentSchema = z
  .enum(["CONFIRMED", "ASK"])
  .openapi("NewsletterConsent");

export const addNewsletterSubscriberRequestSchema = z
  .object({
    email: newsletterEmailSchema,
    name: z.string().trim().max(200).nullable().optional(),
    consent: newsletterConsentSchema,
  })
  .openapi("AddNewsletterSubscriberRequest");

export const addNewsletterSubscribersFromContactsRequestSchema = z
  .object({
    contactIds: z.array(z.uuid()).max(1000).optional(),
    listIds: z.array(z.uuid()).max(20).optional(),
    consent: newsletterConsentSchema,
  })
  .refine(
    (input) =>
      (input.contactIds?.length ?? 0) + (input.listIds?.length ?? 0) > 0,
    {
      message: "Provide at least one contact or list id",
    },
  )
  .openapi("AddNewsletterSubscribersFromContactsRequest");

export const newsletterAddFromContactsResultSchema = z
  .object({
    added: z.int().nonnegative(),
    alreadySubscribed: z.int().nonnegative(),
    skippedUnsubscribed: z.int().nonnegative(),
    skippedBounced: z.int().nonnegative(),
    skippedNoEmail: z.int().nonnegative(),
    pendingConfirmation: z.int().nonnegative(),
  })
  .openapi("NewsletterAddFromContactsResult");

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
    consent: newsletterConsentSchema,
  })
  .openapi("ImportNewsletterSubscribersRequest");

export const newsletterImportResultSchema = z
  .object({
    imported: z.int().nonnegative(),
    skippedExisting: z.int().nonnegative().openapi({
      description:
        "Valid rows skipped because the email already exists in the newsletter or CSV.",
    }),
    skippedUnsubscribed: z.int().nonnegative(),
    skippedBounced: z.int().nonnegative(),
    pendingConfirmation: z.int().nonnegative(),
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
export type AddNewsletterSubscribersFromContactsRequest = z.infer<
  typeof addNewsletterSubscribersFromContactsRequestSchema
>;
export type NewsletterConsent = z.infer<typeof newsletterConsentSchema>;
export type ImportNewsletterSubscribersRequest = z.infer<
  typeof importNewsletterSubscribersRequestSchema
>;
export type PatchNewsletterSubscriberRequest = z.infer<
  typeof patchNewsletterSubscriberRequestSchema
>;
