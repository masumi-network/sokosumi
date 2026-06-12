import { z } from "@hono/zod-openapi";

/** Stripe invoice statuses surfaced through the admin invoice API. */
export const invoiceStatusSchema = z
  .enum(["draft", "open", "paid", "uncollectible", "void"])
  .openapi({ example: "open" });

export const invoiceTargetTypeSchema = z
  .enum(["user", "organization"])
  .openapi({ example: "organization" });

export const invoiceStatusFilterSchema = z
  .enum(["unfinished", "all", "draft", "open", "paid", "uncollectible", "void"])
  .openapi({
    example: "unfinished",
    description:
      'Status filter: "unfinished" (draft + open, the default), "all", or a specific Stripe invoice status.',
  });

export const invoiceSummarySchema = z
  .object({
    invoiceId: z.string().openapi({ example: "in_123" }),
    targetType: invoiceTargetTypeSchema,
    targetId: z.string().openapi({ example: "org_123" }),
    targetName: z.string().openapi({ example: "Acme" }),
    credits: z.number().openapi({ example: 100 }),
    ttlDays: z.number().nullable().openapi({ example: 30 }),
    currency: z.string().openapi({ example: "eur" }),
    amountDue: z.number().openapi({ example: 12000 }),
    status: invoiceStatusSchema.nullable(),
    dashboardUrl: z.string().openapi({
      example: "https://dashboard.stripe.com/acct_123/invoices/in_123",
    }),
  })
  .openapi("InvoiceSummary");

export const invoiceListItemSchema = z
  .object({
    invoiceId: z.string().openapi({ example: "in_123" }),
    targetType: invoiceTargetTypeSchema.nullable(),
    targetName: z.string().nullable().openapi({ example: "Acme" }),
    credits: z.number().openapi({ example: 100 }),
    ttlDays: z.number().nullable().openapi({ example: null }),
    currency: z.string().openapi({ example: "eur" }),
    amountDue: z.number().openapi({ example: 12000 }),
    status: invoiceStatusSchema.nullable(),
    createdAt: z
      .number()
      .openapi({ example: 1736294400000, description: "Unix ms timestamp" }),
    dashboardUrl: z.string().openapi({
      example: "https://dashboard.stripe.com/acct_123/invoices/in_123",
    }),
  })
  .openapi("InvoiceListItem");

export const invoiceListSchema = z.array(invoiceListItemSchema);

export const creditPriceOptionSchema = z
  .object({
    id: z.string().openapi({ example: "price_123" }),
    amountPerCredit: z.number().openapi({ example: 120 }),
    currency: z.string().openapi({ example: "eur" }),
    nickname: z.string().nullable().openapi({ example: "Standard" }),
  })
  .openapi("CreditPriceOption");

export const creditPriceOptionListSchema = z.array(creditPriceOptionSchema);

export const createInvoiceSchema = z
  .object({
    targetType: invoiceTargetTypeSchema,
    targetId: z.string().min(1).openapi({ example: "org_123" }),
    credits: z.number().int().positive().openapi({ example: 100 }),
    ttlDays: z.number().int().nullable().openapi({ example: 30 }),
    priceId: z.string().nullable().openapi({ example: "price_123" }),
    markFree: z.boolean().openapi({ example: false }),
  })
  .openapi("CreateInvoice");

export const listInvoicesQuerySchema = z
  .object({
    status: invoiceStatusFilterSchema.optional(),
    recipientType: invoiceTargetTypeSchema.optional(),
    recipientId: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .refine(
    (query) =>
      (query.recipientType === undefined) === (query.recipientId === undefined),
    {
      message: "recipientType and recipientId must be provided together",
    },
  );
