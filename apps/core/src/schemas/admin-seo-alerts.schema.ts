import { z } from "@hono/zod-openapi";
import { seoFullAuditCostSchema } from "./seo-audit-price.schema";

export const SEO_ALERTS_PAGE_SIZE = 25;
export const SEO_PAGE_FAILURE_PERCENT = 25;
export const SEO_IMPORT_GRACE_MINUTES = 15;
// seo-bot DELIVERY_DEADLINE_MS, measured conservatively from the worker’s RUNNING event.
export const SEO_WORKER_DEADLINE_MINUTES = 120;
export const adminSeoAlertQuery = z.object({
  view: z.enum(["counts", "connections", "billing"]).optional(),
  period: z.enum(["7", "30", "90", "all"]).default("30"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
});
const count = z.number().int().nonnegative();
const workspaceReference = {
  workspaceId: z.uuid().nullable(),
  workspaceOrganizationSlug: z.string().nullable(),
  workspaceUserId: z.string().nullable(),
};
const reason = z.enum([
  "priceUnverified",
  "priceUnpaid",
  "dataBudgetExceeded",
  "priceReceiptPending",
  "priceNeedsCredits",
  "priceRetry",
  "workerOverdue",
  "workerFailed",
  "auditFailed",
  "reportRejected",
  "pageException",
  "pageFailureRate",
  "seasonalFailed",
  "explorationFailed",
  "investigationFailed",
  "speedPagesFailed",
  "editorialGemini",
  "editorialCodex",
  "editorialValidation",
  "webRiskNotRun",
  "webRiskFailed",
  "lighthouseFailed",
  "reportMissing",
  "gscDisconnected",
  "gscProperty",
  "gscUnavailable",
  "gscSkipped",
]);
export const adminSeoBillingRow = z.object({
  id: z.uuid(),
  taskId: z.string().nullable(),
  auditId: z.uuid().nullable(),
  projectId: z.uuid().nullable(),
  workspaceId: z.uuid().nullable(),
  at: z.iso.datetime(),
  status: z.enum([
    "inProgress",
    "receiptsPending",
    "needsCredits",
    "retrying",
    "settled",
    "closed",
    "abandoned",
    "unverified",
  ]),
  approvedMaxCredits: count.nullable(),
  attemptedCredits: z.number().nonnegative().nullable(),
  dataBudgetUsd: z.number().nonnegative().nullable(),
  chargedCredits: z.number().nonnegative().nullable(),
  cost: seoFullAuditCostSchema.nullable(),
});

export const adminSeoAlerts = z
  .object({
    total: count,
    critical: count,
    warning: count,
    info: count,
    pageSize: count,
    failurePercent: count,
    importGraceMinutes: count,
    billingTotal: count,
    pricingAttention: count,
    billing: z.array(adminSeoBillingRow),
    connectionTotal: count,
    reconnect: count,
    connections: z.array(
      z.object({
        id: z.uuid(),
        ...workspaceReference,
        userId: z.string(),
        provider: z.enum(["ga4", "search_console"]),
        status: z.enum(["NEEDS_RECONNECT", "DISCONNECTED"]),
        at: z.iso.datetime(),
      }),
    ),
    items: z.array(
      z.object({
        id: z.uuid(),
        ...workspaceReference,
        auditId: z.uuid().nullable(),
        projectId: z.uuid().nullable(),
        taskId: z.string().nullable(),
        at: z.iso.datetime(),
        severity: z.enum(["critical", "warning", "info"]),
        reasons: z.array(reason).min(1),
        failedPages: count,
        attemptedPages: count,
      }),
    ),
  })
  .openapi("AdminSeoAlerts");
