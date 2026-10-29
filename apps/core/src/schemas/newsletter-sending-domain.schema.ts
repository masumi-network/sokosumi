import { z } from "@hono/zod-openapi";
import { NewsletterSendingDomainStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime";

export const newsletterDnsRecordSchema = z
  .object({
    record: z.string(),
    type: z.string(),
    name: z.string(),
    value: z.string(),
    ttl: z.string(),
    priority: z.number().nullable(),
    status: z.string(),
  })
  .openapi("NewsletterDnsRecord");

export const newsletterDnsRecordsSchema = z.array(newsletterDnsRecordSchema);

export const newsletterSendingDomainWarmupSchema = z
  .object({
    startedAt: dateTimeSchema.nullable(),
    day: z.number().int().min(0).nullable(),
    dailyCap: z.number().int().min(0).nullable(),
    sentToday: z.number().int().min(0),
    pausedAt: dateTimeSchema.nullable(),
    pauseReason: z.enum(["BOUNCE_RATE", "COMPLAINT_RATE"]).nullable(),
  })
  .openapi("NewsletterSendingDomainWarmup");

export const newsletterSendingDomainSchema = z
  .object({
    id: z.uuid(),
    domain: z.string(),
    fromAddress: z.string(),
    status: z
      .enum(NewsletterSendingDomainStatus)
      .openapi("NewsletterSendingDomainStatus"),
    dnsRecords: newsletterDnsRecordsSchema,
    lastCheckedAt: dateTimeSchema.nullable(),
    failureReason: z.string().nullable(),
    createdAt: dateTimeSchema,
    warmup: newsletterSendingDomainWarmupSchema,
  })
  .openapi("NewsletterSendingDomain");

export const newsletterSendingDomainStateSchema = z
  .object({
    // A union, not `.nullable()`, so the shared component itself stays non-null.
    sendingDomain: z.union([newsletterSendingDomainSchema, z.null()]).openapi({
      description: "Null until a workspace owner or admin adds one.",
    }),
    /** Whether the caller may add, verify, connect and remove the domain. */
    canManage: z.boolean(),
    /** Whether the shared Sokosumi domain sends until this one is verified. */
    fallbackAvailable: z.boolean(),
  })
  .openapi("NewsletterSendingDomainState");

export const putNewsletterSendingDomainRequestSchema = z
  .object({ fromAddress: z.email().max(254) })
  .openapi("PutNewsletterSendingDomainRequest");

export const connectNewsletterSendingDomainCloudflareRequestSchema = z
  .object({
    /** Used once to create the DNS records; never stored. */
    apiToken: z.string().trim().min(20).max(256),
  })
  .openapi("ConnectNewsletterSendingDomainCloudflareRequest");

export const newsletterSendingDomainConnectQuerySchema = z.object({
  projectId: z.uuid().optional(),
});

export const newsletterSendingDomainConnectSchema = z
  .object({ providerName: z.string(), applyUrl: z.url() })
  .nullable()
  .openapi("NewsletterSendingDomainConnect");
