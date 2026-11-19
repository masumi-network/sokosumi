import { z } from "@hono/zod-openapi";

export const SEO_ALERTS_PAGE_SIZE = 25;
export const SEO_PAGE_FAILURE_PERCENT = 25;
export const SEO_IMPORT_GRACE_MINUTES = 15;
export const adminSeoAlertQuery = z.object({
  view: z.enum(["counts", "connections"]).optional(),
  period: z.enum(["7", "30", "90", "all"]).default("30"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
});
const count = z.number().int().nonnegative();
const reason = z.enum([
  "workerFailed",
  "auditFailed",
  "reportRejected",
  "pageException",
  "pageFailureRate",
  "reportMissing",
  "gscDisconnected",
  "gscProperty",
  "gscUnavailable",
  "gscSkipped",
]);
export const adminSeoAlerts = z
  .object({
    total: count,
    critical: count,
    warning: count,
    info: count,
    pageSize: count,
    failurePercent: count,
    importGraceMinutes: count,
    connectionTotal: count,
    reconnect: count,
    connections: z.array(
      z.object({
        id: z.uuid(),
        userId: z.string(),
        provider: z.enum(["ga4", "search_console"]),
        status: z.enum(["NEEDS_RECONNECT", "DISCONNECTED"]),
        at: z.iso.datetime(),
      }),
    ),
    items: z.array(
      z.object({
        id: z.uuid(),
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
