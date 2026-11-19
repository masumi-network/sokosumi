import type { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
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
} from "@/schemas/admin-seo-alerts.schema";

/** Project-only analyses predate named audits. Each is a distinct run. */
export async function listAdminSeoAlerts(
  { period, page, view }: z.output<typeof adminSeoAlertQuery>,
  client: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
) {
  const periodFilter =
    period === "all"
      ? PrismaRaw.empty
      : PrismaRaw.sql`AND at >= (now() AT TIME ZONE 'UTC') - make_interval(days => ${Number(period)}::int)`;
  const [result] = await client.$queryRaw<
    Record<string, unknown>[]
  >(PrismaRaw.sql`
    WITH runs AS (
      SELECT coalesce(a."auditId", a.id) AS id, a.id AS run, a."createdAt", a."taskId", a."auditId", a."projectId",
        a."requestedBy", a.request, a.status, a."failureReason" = ${SEO_REPORT_IMPORT_REJECTED} AS rejected,
        t.status AS task_status, coalesce(au."workspaceId", p."workspaceId") AS workspace,
        terminal."coworkerId" = t."assigneeId" AS worker_failed,
        coalesce(terminal."createdAt", t."updatedAt") AS settled_at,
        greatest(a."updatedAt", coalesce(terminal."createdAt", t."updatedAt")) AS at
      FROM project_seo_analysis a
      LEFT JOIN seo_audit au ON au.id = a."auditId"
      LEFT JOIN project p ON p.id = a."projectId"
      LEFT JOIN task t ON t.id = a."taskId"
      LEFT JOIN LATERAL (SELECT e."createdAt", e."coworkerId" FROM "taskEvent" e
        WHERE e."taskId" = t.id AND e.status = t.status AND t.status IN ('FAILED','COMPLETED')
        ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1) terminal ON true
      WHERE a.kind = 'audit_full' AND au."deletedAt" IS NULL
    ), latest AS (
      SELECT DISTINCT ON (id) * FROM runs
      WHERE status IN ('completed','failed') OR task_status = 'FAILED' OR
        (task_status = 'COMPLETED' AND settled_at <= (now() AT TIME ZONE 'UTC') - make_interval(mins => ${SEO_IMPORT_GRACE_MINUTES}::int))
      ORDER BY id, "createdAt" DESC, run DESC
    ), current_connections AS (
      SELECT c.id,c."userId",c.provider,c.status,c."updatedAt"
      FROM seo_connection c
      WHERE c.provider IN ('ga4','search_console') AND c.status IN ('NEEDS_RECONNECT','DISCONNECTED')
        AND EXISTS(SELECT 1 FROM runs r WHERE r.workspace = c."workspaceId" AND r."requestedBy" = c."userId")
    ), evidence AS (
      SELECT l.*, jsonb_typeof(l.request -> 'searchConsoleAccess') AS consent,
        receipt.not_connected, receipt.needs_property, receipt.unavailable, report."pageIds" IS NOT NULL AS imported,
        coalesce(cardinality(report."pageIds"), 0) AS completed_pages,
        CASE WHEN jsonb_typeof(report.payload -> 'pageRunFailures') = 'number' AND
          (report.payload ->> 'pageRunFailures') ~ '^(10|[0-9])$'
        THEN (report.payload ->> 'pageRunFailures')::int ELSE page_errors.failed_pages END AS failed_pages
      FROM latest l
      LEFT JOIN LATERAL (
        SELECT o."pageIds", o.payload
        FROM project_seo_observation o
        WHERE o."sourceTaskId" = l."taskId" AND o.kind = 'audit_full' AND o.source = 'seo_coworker'
          AND o."auditId" IS NOT DISTINCT FROM l."auditId" AND o."projectId" IS NOT DISTINCT FROM l."projectId"
        ORDER BY o."createdAt" DESC, o.id DESC LIMIT 1
      ) report ON true
      LEFT JOIN LATERAL (
        SELECT bool_or(o.payload #>> '{receipt,status}' = 'not_connected') AS not_connected,
          bool_or(o.payload #>> '{receipt,status}' = 'needs_property') AS needs_property,
          bool_or(o.payload #>> '{receipt,status}' = 'unavailable' AND
            o.payload -> 'providerAnsweredAll' IS DISTINCT FROM 'true'::jsonb) AS unavailable
        FROM project_seo_observation o
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
      SELECT id, "taskId", at, failed_pages AS "failedPages", completed_pages + failed_pages AS "attemptedPages",
        array_remove(ARRAY[
          CASE WHEN task_status = 'FAILED' AND worker_failed THEN 'workerFailed'
               WHEN status = 'failed' AND rejected THEN 'reportRejected'
               WHEN status = 'failed' OR task_status = 'FAILED' THEN 'auditFailed'
               WHEN task_status = 'COMPLETED' AND NOT imported AND settled_at <= (now() AT TIME ZONE 'UTC') - make_interval(mins => ${SEO_IMPORT_GRACE_MINUTES}::int) THEN 'reportMissing' END,
          CASE WHEN failed_pages > 0 THEN 'pageException' END,
          CASE WHEN failed_pages > 0 AND failed_pages * 100 >= ${SEO_PAGE_FAILURE_PERCENT}::int * (completed_pages + failed_pages) THEN 'pageFailureRate' END,
          CASE WHEN consent = 'null' THEN 'gscSkipped' END,
          CASE WHEN consent IS DISTINCT FROM 'null' AND not_connected THEN 'gscDisconnected' END,
          CASE WHEN consent IS DISTINCT FROM 'null' AND needs_property THEN 'gscProperty' END,
          CASE WHEN consent IS DISTINCT FROM 'null' AND unavailable THEN 'gscUnavailable' END
        ], NULL) AS reasons
      FROM evidence
    ), alerts AS (
      SELECT *, CASE WHEN reasons && ARRAY['workerFailed','auditFailed','reportRejected','reportMissing'] THEN 'critical'
                     WHEN reasons <@ ARRAY['gscSkipped'] THEN 'info'
                     ELSE 'warning' END AS severity
      FROM classified WHERE cardinality(reasons) > 0
    )
    SELECT count(*)::int AS total, count(*) FILTER (WHERE severity='critical')::int AS critical,
      count(*) FILTER (WHERE severity='warning')::int AS warning, count(*) FILTER (WHERE severity='info')::int AS info,
      (SELECT count(*)::int FROM current_connections) AS "connectionTotal",
      (SELECT count(*)::int FROM current_connections WHERE status = 'NEEDS_RECONNECT') AS reconnect,
      coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.status DESC, c.at DESC, c.id) FROM (
        SELECT id, "userId", provider, status, to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at FROM current_connections
        ORDER BY status DESC, "updatedAt" DESC, id LIMIT ${view === "connections" ? SEO_ALERTS_PAGE_SIZE : 0} OFFSET ${(page - 1) * SEO_ALERTS_PAGE_SIZE}
      ) c), '[]'::jsonb) AS connections,
      coalesce((SELECT jsonb_agg(to_jsonb(rows) - 'urgency' ORDER BY rows.urgency, rows.at DESC, rows.id) FROM (
        SELECT id, "taskId", to_char(at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at, severity, reasons, "failedPages", "attemptedPages",
          CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END AS urgency
        FROM alerts ORDER BY urgency, alerts.at DESC, id LIMIT ${view === undefined ? SEO_ALERTS_PAGE_SIZE : 0} OFFSET ${(page - 1) * SEO_ALERTS_PAGE_SIZE}
      ) rows), '[]'::jsonb) AS items FROM alerts
  `);
  return adminSeoAlerts.parse({
    ...result,
    pageSize: SEO_ALERTS_PAGE_SIZE,
    failurePercent: SEO_PAGE_FAILURE_PERCENT,
    importGraceMinutes: SEO_IMPORT_GRACE_MINUTES,
  });
}
