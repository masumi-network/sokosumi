import type { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { SEO_FULL_AUDIT_CREDITS, seoFullAuditPrice } from "@sokosumi/utils";
import {
  SEO_PRICE_PENDING_COMMENT,
  seoBillingCtes,
} from "@/helpers/admin-seo-billing";
import {
  SEO_PAGE_RUN_FAILURE_PREFIX,
  SEO_REPORT_IMPORT_REJECTED,
} from "@/helpers/project-seo-public-report";
import prisma from "@/lib/db/prisma";
import {
  type adminSeoAlertQuery,
  adminSeoAlerts,
  SEO_ALERTS_PAGE_SIZE,
  SEO_IMPORT_GRACE_MINUTES,
  SEO_PAGE_FAILURE_PERCENT,
  SEO_WORKER_DEADLINE_MINUTES,
} from "@/schemas/admin-seo-alerts.schema";
import { seoFullAuditCostDetailSchema } from "@/schemas/seo-audit-price.schema";

/** Project-only analyses predate named audits. Each is a distinct run. */
export async function listAdminSeoAlerts(
  { period, page, view }: z.output<typeof adminSeoAlertQuery>,
  client: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
) {
  const newPrice = JSON.stringify(seoFullAuditPrice());
  const cappedPrice = JSON.stringify(seoFullAuditPrice(SEO_FULL_AUDIT_CREDITS));
  const periodFilter =
    period === "all"
      ? PrismaRaw.empty
      : PrismaRaw.sql`AND (overdue OR price_pending OR needs_credits OR retrying OR billing_attention OR at >= (now() AT TIME ZONE 'UTC') - make_interval(days => ${Number(period)}::int))`;
  const [result] = await client.$queryRaw<
    Record<string, unknown>[]
  >(PrismaRaw.sql`
    WITH workspaces AS (
      SELECT w.id, w."userId" AS "workspaceUserId", org.slug AS "workspaceOrganizationSlug"
      FROM ${sharedTable("workspace")} w LEFT JOIN ${sharedTable("organization")} org ON org.id = w."organizationId"
    ), runs AS (
      SELECT coalesce(a."auditId", a.id) AS id, a.id AS run, a."createdAt", a."taskId", a."auditId", a."projectId",
        a."requestedBy", a.request, a.status, a."failureReason" = ${SEO_REPORT_IMPORT_REJECTED} AS rejected,
        t.status AS task_status, a.request #>> '{fullAuditBillingContext,coworkerId}' AS approved_worker, coalesce(au."workspaceId", p."workspaceId") AS workspace, w."workspaceOrganizationSlug", w."workspaceUserId",
        terminal."coworkerId" = t."assigneeId" AS worker_failed,
        terminal."coworkerId" AS event_coworker,
        coalesce((a.request -> 'price') IN (${newPrice}::jsonb, ${cappedPrice}::jsonb), false) AS metered,
        marker."createdAt" IS NOT NULL AND marker.status IS NULL AND t.status NOT IN ('COMPLETED','FAILED','CANCELED') AS price_pending,
        marker.status = 'OUT_OF_CREDITS' AND t.status NOT IN ('OUT_OF_CREDITS','COMPLETED','FAILED','CANCELED') AS balance_retry,
        terminal.cents AS attempted_charge,
        coalesce(terminal."createdAt", t."updatedAt") AS settled_at,
        greatest(a."updatedAt", marker."createdAt", coalesce(terminal."createdAt", t."updatedAt")) AS at
      FROM ${sharedTable("project_seo_analysis")} a
      LEFT JOIN ${sharedTable("seo_audit")} au ON au.id = a."auditId"
      LEFT JOIN ${sharedTable("project")} p ON p.id = a."projectId"
      LEFT JOIN workspaces w ON w.id = coalesce(au."workspaceId",p."workspaceId")
      LEFT JOIN ${sharedTable("task")} t ON t.id = a."taskId"
      LEFT JOIN LATERAL (SELECT e."createdAt", e."coworkerId",e.cents FROM ${sharedTable("taskEvent")} e
        WHERE e."taskId" = t.id AND e.status = t.status AND t.status IN ('FAILED','COMPLETED','RUNNING','OUT_OF_CREDITS')
        ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1) terminal ON true
      LEFT JOIN LATERAL (SELECT e."createdAt", e.status FROM ${sharedTable("taskEvent")} e
        WHERE e."taskId" = t.id AND e."coworkerId" = a.request #>> '{fullAuditBillingContext,coworkerId}'
          AND e."userId" IS NULL AND e."sokoBotId" IS NULL
          AND ((e.status IS NULL AND e.comment = ${SEO_PRICE_PENDING_COMMENT})
            OR (e.status = 'OUT_OF_CREDITS' AND e.cents > 0 AND e."transactionId" IS NULL))
          AND a.request #>> '{price,kind}' = 'cost_plus'
          AND NOT EXISTS(SELECT 1 FROM ${sharedTable("taskEvent")} closed WHERE closed."taskId"=t.id
            AND closed.status IN ('FAILED','COMPLETED','CANCELED') AND closed."createdAt" >= e."createdAt")
        ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1) marker ON true
      WHERE a.kind = 'audit_full' AND au."deletedAt" IS NULL AND au."archivedAt" IS NULL
    ), progress AS (
      SELECT *, (metered AND balance_retry) IS TRUE AS retrying, (metered AND task_status = 'OUT_OF_CREDITS' AND event_coworker=approved_worker AND attempted_charge > 0) IS TRUE AS needs_credits,
        (status NOT IN ('completed','failed') AND task_status = 'RUNNING' AND worker_failed
        AND settled_at <= (now() AT TIME ZONE 'UTC') - make_interval(mins => ${SEO_WORKER_DEADLINE_MINUTES}::int)) AS overdue
      FROM runs
    ), ${seoBillingCtes()}, priced_runs AS (
      SELECT p.*, b.cap AS "approvedMaxCredits", b.billing_status, b.cost, b.attempted_credits, b.charged_credits, b.data_budget, b.over_budget,
        coalesce(b.billing_status IN ('unverified', 'abandoned') OR b.over_budget, false) AS billing_attention
      FROM progress p LEFT JOIN billing_summary b USING(run)
    ), ranked_runs AS (
      SELECT *, row_number() OVER (PARTITION BY id ORDER BY "createdAt" DESC, run DESC) AS recency FROM priced_runs
      WHERE billing_attention OR (metered AND price_pending) OR needs_credits OR retrying OR overdue OR status IN ('completed','failed') OR task_status = 'FAILED' OR
        (task_status = 'COMPLETED' AND settled_at <= (now() AT TIME ZONE 'UTC') - make_interval(mins => ${SEO_IMPORT_GRACE_MINUTES}::int))
    ), latest AS (
      SELECT * FROM ranked_runs
      WHERE recency = 1 OR billing_attention OR (metered AND price_pending) OR needs_credits OR retrying
    ), billing_runs AS (
      SELECT run AS id,"taskId","auditId","projectId",workspace AS "workspaceId",at,"approvedMaxCredits",
        billing_status AS status,cost,CASE WHEN cost IS NOT NULL THEN request -> 'fullAuditCostDetail' END AS "costDetail",attempted_credits AS "attemptedCredits",charged_credits AS "chargedCredits",data_budget AS "dataBudgetUsd",billing_attention
      FROM priced_runs WHERE metered ${periodFilter}
    ), current_connections AS (
      SELECT c.id,c."userId",c.provider,c.status,c."updatedAt",c."workspaceId",w."workspaceOrganizationSlug",w."workspaceUserId"
      FROM ${sharedTable("seo_connection")} c LEFT JOIN workspaces w ON w.id=c."workspaceId"
      WHERE c.provider IN ('ga4','search_console') AND c.status IN ('NEEDS_RECONNECT','DISCONNECTED')
        AND EXISTS(SELECT 1 FROM runs r WHERE r.workspace = c."workspaceId" AND r."requestedBy" = c."userId")
    ), evidence AS (
      SELECT l.*, jsonb_typeof(l.request -> 'searchConsoleAccess') AS consent,
        receipt.not_connected, receipt.needs_property, receipt.unavailable, report."pageIds" IS NOT NULL AS imported,
        coalesce(cardinality(report."pageIds"), 0) AS completed_pages,
        CASE WHEN jsonb_typeof(report.payload -> 'specialistFailures') = 'array' THEN report.payload -> 'specialistFailures' END AS specialists,
        CASE WHEN jsonb_typeof(report.payload -> 'sourceFailures') = 'array' THEN report.payload -> 'sourceFailures' END AS sources,
        CASE WHEN jsonb_typeof(report.payload -> 'pageRunFailures') = 'number' AND
          (report.payload ->> 'pageRunFailures') ~ '^(10|[0-9])$'
        THEN (report.payload ->> 'pageRunFailures')::int ELSE page_errors.failed_pages END AS failed_pages
      FROM latest l
      LEFT JOIN LATERAL (
        SELECT o."pageIds", o.payload
        FROM ${sharedTable("project_seo_observation")} o
        WHERE o."sourceTaskId" = l."taskId" AND o.kind = 'audit_full' AND o.source = 'seo_coworker'
          AND o."auditId" IS NOT DISTINCT FROM l."auditId" AND o."projectId" IS NOT DISTINCT FROM l."projectId"
        ORDER BY o."createdAt" DESC, o.id DESC LIMIT 1
      ) report ON true
      LEFT JOIN LATERAL (
        SELECT bool_or(o.payload #>> '{receipt,status}' = 'not_connected') AS not_connected,
          bool_or(o.payload #>> '{receipt,status}' = 'needs_property') AS needs_property,
          bool_or(o.payload #>> '{receipt,status}' = 'unavailable' AND
            o.payload -> 'providerAnsweredAll' IS DISTINCT FROM 'true'::jsonb) AS unavailable
        FROM ${sharedTable("project_seo_observation")} o
        WHERE o."sourceTaskId" = l."taskId" AND o.source = 'search_console' AND o.kind = 'index_inspection'
          AND o."ownerId" = l."requestedBy" AND o."auditId" IS NOT DISTINCT FROM l."auditId"
          AND o."projectId" IS NOT DISTINCT FROM l."projectId"
      ) receipt ON true
      -- Historical imports kept per-page exceptions in a fixed note keyed to the
      -- approved URL. Match the producer's exact prefix; no note or URL leaves SQL.
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT url)::int AS failed_pages
        FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.request -> 'pageUrls') = 'array' THEN l.request -> 'pageUrls' ELSE '[]' END) approved(url)
        WHERE NOT (report.payload ? 'pageRunFailures') AND NOT (coalesce(report.payload -> 'pageUrls', '[]'::jsonb) ? url)
          AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(report.payload -> 'notes') = 'array' THEN report.payload -> 'notes' ELSE '[]' END) n(note)
            WHERE starts_with(note, 'Page not audited: ' || url || ' (' || ${SEO_PAGE_RUN_FAILURE_PREFIX}))
      ) page_errors ON true
      WHERE true ${periodFilter}
    ), classified AS (
      SELECT CASE WHEN recency = 1 THEN id ELSE run END AS id, "taskId", "auditId", "projectId", workspace AS "workspaceId", "workspaceUserId", "workspaceOrganizationSlug", at, failed_pages AS "failedPages", completed_pages + failed_pages AS "attemptedPages",
        array_remove(ARRAY[
          CASE WHEN billing_status='unverified' THEN 'priceUnverified'
               WHEN billing_status='abandoned' THEN 'priceUnpaid'
               WHEN needs_credits THEN 'priceNeedsCredits'
               WHEN retrying THEN 'priceRetry'
               WHEN metered AND price_pending THEN 'priceReceiptPending' END,
          CASE WHEN overdue AND NOT imported AND NOT (metered AND coalesce(price_pending, false)) THEN 'workerOverdue'
               WHEN task_status = 'FAILED' AND worker_failed THEN 'workerFailed'
               WHEN status = 'failed' AND rejected THEN 'reportRejected'
               WHEN status = 'failed' OR task_status = 'FAILED' THEN 'auditFailed'
               WHEN task_status = 'COMPLETED' AND NOT imported AND settled_at <= (now() AT TIME ZONE 'UTC') - make_interval(mins => ${SEO_IMPORT_GRACE_MINUTES}::int) THEN 'reportMissing' END,
          CASE WHEN over_budget THEN 'dataBudgetExceeded' END,
          CASE WHEN failed_pages > 0 THEN 'pageException' END,
          CASE WHEN failed_pages > 0 AND failed_pages * 100 >= ${SEO_PAGE_FAILURE_PERCENT}::int * (completed_pages + failed_pages) THEN 'pageFailureRate' END,
          CASE WHEN specialists ? 'seasonal' THEN 'seasonalFailed' END,
          CASE WHEN specialists ? 'exploration' THEN 'explorationFailed' END,
          CASE WHEN specialists ? 'searchInvestigation' THEN 'investigationFailed' END,
          CASE WHEN specialists ? 'speedPages' THEN 'speedPagesFailed' END,
          CASE WHEN specialists ? 'editorialGemini' THEN 'editorialGemini' END,
          CASE WHEN specialists ? 'editorialCodex' THEN 'editorialCodex' END,
          CASE WHEN specialists ? 'editorialValidation' THEN 'editorialValidation' END,
          CASE WHEN sources ? 'webRiskNotRun' THEN 'webRiskNotRun' END,
          CASE WHEN sources ? 'webRiskFailed' THEN 'webRiskFailed' END,
          CASE WHEN sources ? 'lighthouseFailed' THEN 'lighthouseFailed' END,
          CASE WHEN consent = 'null' THEN 'gscSkipped' END,
          CASE WHEN consent IS DISTINCT FROM 'null' AND not_connected THEN 'gscDisconnected' END,
          CASE WHEN consent IS DISTINCT FROM 'null' AND needs_property THEN 'gscProperty' END,
          CASE WHEN consent IS DISTINCT FROM 'null' AND unavailable THEN 'gscUnavailable' END
        ], NULL) AS reasons
      FROM evidence
    ), alerts AS (
      SELECT *, CASE WHEN reasons && ARRAY['priceUnverified','workerFailed','auditFailed','reportRejected','reportMissing'] THEN 'critical'
                     WHEN reasons <@ ARRAY['gscSkipped'] THEN 'info'
                     ELSE 'warning' END AS severity
      FROM classified WHERE cardinality(reasons) > 0
    )
    SELECT count(*)::int AS total, count(*) FILTER (WHERE severity='critical')::int AS critical,
      count(*) FILTER (WHERE severity='warning')::int AS warning, count(*) FILTER (WHERE severity='info')::int AS info,
      (SELECT count(*)::int FROM billing_runs) AS "billingTotal",
      (SELECT count(*)::int FROM billing_runs WHERE billing_attention OR status IN ('receiptsPending','needsCredits','retrying')) AS "pricingAttention",
      coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.at DESC,b.id) FROM (
        SELECT id,"taskId","auditId","projectId","workspaceId","approvedMaxCredits",status,cost,"costDetail","attemptedCredits","chargedCredits","dataBudgetUsd",to_char(at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at FROM billing_runs
        ORDER BY billing_runs.at DESC,id LIMIT ${view === "billing" ? SEO_ALERTS_PAGE_SIZE : 0} OFFSET ${(page - 1) * SEO_ALERTS_PAGE_SIZE}) b), '[]'::jsonb) AS billing,
      (SELECT count(*)::int FROM current_connections) AS "connectionTotal",
      (SELECT count(*)::int FROM current_connections WHERE status = 'NEEDS_RECONNECT') AS reconnect,
      coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.status DESC, c.at DESC, c.id) FROM (
        SELECT id, "userId", "workspaceId", "workspaceUserId", "workspaceOrganizationSlug", provider, status, to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at FROM current_connections
        ORDER BY status DESC, "updatedAt" DESC, id LIMIT ${view === "connections" ? SEO_ALERTS_PAGE_SIZE : 0} OFFSET ${(page - 1) * SEO_ALERTS_PAGE_SIZE}
      ) c), '[]'::jsonb) AS connections,
      coalesce((SELECT jsonb_agg(to_jsonb(rows) - 'urgency' ORDER BY rows.urgency, rows.at DESC, rows.id) FROM (
        SELECT id, "taskId", "auditId", "projectId", "workspaceId", "workspaceUserId", "workspaceOrganizationSlug", to_char(at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at, severity, reasons, "failedPages", "attemptedPages",
          CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END AS urgency
        FROM alerts ORDER BY urgency, alerts.at DESC, id LIMIT ${view === undefined ? SEO_ALERTS_PAGE_SIZE : 0} OFFSET ${(page - 1) * SEO_ALERTS_PAGE_SIZE}
      ) rows), '[]'::jsonb) AS items FROM alerts
  `);
  return adminSeoAlerts.parse({
    ...result,
    // Stored worker JSON: a detail that no longer parses reads as absent.
    billing: Array.isArray(result?.billing)
      ? result.billing.map((row) => ({
          ...row,
          costDetail:
            seoFullAuditCostDetailSchema.safeParse(row?.costDetail).data ??
            null,
        }))
      : result?.billing,
    pageSize: SEO_ALERTS_PAGE_SIZE,
    failurePercent: SEO_PAGE_FAILURE_PERCENT,
    importGraceMinutes: SEO_IMPORT_GRACE_MINUTES,
  });
}
