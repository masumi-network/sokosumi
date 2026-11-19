import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import {
  SEGMENTED_CONTROL_CLASS_NAME,
  SEGMENTED_CONTROL_ITEM_CLASS_NAME,
} from "@/components/ui/segmented-control-classes";
import { readAdminSeoAlerts } from "@/lib/services/admin-seo-alerts.service";
import { cn } from "@/lib/utils";
import { SeoAuditBilling } from "./seo-audit-billing";

function Reference({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const code = <code className="select-all break-all">{value}</code>;
  return (
    <span className="text-muted-foreground text-xs">
      {label}{" "}
      {href ? (
        <Link href={href} className="underline">
          {code}
        </Link>
      ) : (
        code
      )}
    </span>
  );
}

function workspaceHref(row: {
  workspaceOrganizationSlug?: string | null;
  workspaceUserId?: string | null;
}) {
  if (row.workspaceOrganizationSlug)
    return `/admin/organizations/${encodeURIComponent(row.workspaceOrganizationSlug)}`;
  if (row.workspaceUserId)
    return `/admin/users/${encodeURIComponent(row.workspaceUserId)}`;
  return undefined;
}

export const instant = false;
const periods = ["7", "30", "90", "all"] as const;
function listHref(period: string, page = 1, view?: "billing" | "connections") {
  const query = new URLSearchParams({ period });
  if (view) query.set("view", view);
  if (page > 1) query.set("page", String(page));
  return `/admin/seo-alerts?${query}`;
}
// Wrap translated filters when they outgrow the track so every choice remains visible.
const SEGMENTS_CLASS = cn(SEGMENTED_CONTROL_CLASS_NAME, "flex-wrap");
const SEGMENT_CLASS = cn(
  SEGMENTED_CONTROL_ITEM_CLASS_NAME,
  "flex-none max-sm:px-1",
);

export default async function AdminSeoAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; page?: string; view?: string }>;
}) {
  const params = await searchParams;
  const view =
    params.view === "billing" || params.view === "connections"
      ? params.view
      : undefined;
  const connections = view === "connections";
  const period = periods.find((x) => x === params.period) ?? "30";
  const requestedPage = Number(params.page);
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= 1_000_000
      ? requestedPage
      : 1;
  const [alerts, t, format] = await Promise.all([
    readAdminSeoAlerts({
      period,
      page,
      ...(view && { view }),
    }),
    getTranslations("App.Admin.SeoAlerts"),
    getFormatter(),
  ]);
  const total = connections
    ? alerts.connectionTotal
    : view === "billing"
      ? alerts.billingTotal
      : alerts.total;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-2">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <nav aria-label={t("type")} className={SEGMENTS_CLASS}>
        <Link
          href={listHref(period)}
          aria-current={view ? undefined : "page"}
          data-state={view ? "off" : "on"}
          className={SEGMENT_CLASS}
        >
          {t("auditTab", { count: alerts.total })}
        </Link>
        <Link
          href={listHref(period, 1, "connections")}
          aria-current={connections ? "page" : undefined}
          data-state={connections ? "on" : "off"}
          className={SEGMENT_CLASS}
        >
          {t("connectionTab", { count: alerts.connectionTotal })}
        </Link>
        <Link
          href={listHref(period, 1, "billing")}
          aria-current={view === "billing" ? "page" : undefined}
          data-state={view === "billing" ? "on" : "off"}
          className={SEGMENT_CLASS}
        >
          {t("billingTab", { count: alerts.billingTotal ?? 0 })}
        </Link>
      </nav>
      {!connections && (
        <nav aria-label={t("period")} className={SEGMENTS_CLASS}>
          {periods.map((value) => (
            <Link
              key={value}
              href={listHref(value, 1, view)}
              aria-current={period === value ? "page" : undefined}
              data-state={period === value ? "on" : "off"}
              className={SEGMENT_CLASS}
            >
              {value === "all" ? t("all") : t("days", { days: Number(value) })}
            </Link>
          ))}
        </nav>
      )}
      {view === "billing" ? (
        <SeoAuditBilling
          rows={alerts.billing}
          total={total}
          t={t}
          format={format}
        />
      ) : connections ? (
        <>
          <p className="text-muted-foreground text-sm">
            {t("connectionDescription")}
          </p>
          {alerts.connections.length ? (
            <ul className={cn(HOLDER_CLASS, "space-y-2")}>
              {alerts.connections.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    HOLDER_ITEM_CLASS,
                    "flex flex-wrap items-center gap-x-3 gap-y-2 p-3",
                  )}
                >
                  <Badge variant="secondary">
                    {t(
                      row.status === "NEEDS_RECONNECT"
                        ? "reconnect"
                        : "disconnected",
                    )}
                  </Badge>
                  <span className="font-medium">{t(row.provider)}</span>
                  {row.workspaceId && (
                    <Reference
                      label={t("workspaceId")}
                      value={row.workspaceId}
                      href={workspaceHref(row)}
                    />
                  )}
                  <time
                    dateTime={row.at.toISOString()}
                    className="text-muted-foreground text-sm"
                  >
                    {format.dateTime(row.at, "dateTimeMedium")}
                  </time>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="ms-auto max-sm:h-10"
                  >
                    <Link
                      href={`/admin/users/${encodeURIComponent(row.userId)}`}
                    >
                      {t("openAccount")}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              {t(total ? "emptyPage" : "connectionEmpty")}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {t("description", { percent: alerts.failurePercent })}
          </p>

          {/* Four equal tiles on a phone too: two per row there, four from sm. */}
          <dl
            className={cn(
              HOLDER_CLASS,
              "grid grid-cols-2 gap-2 sm:grid-cols-4",
            )}
          >
            {(["total", "critical", "warning", "info"] as const).map(
              (level) => (
                <div
                  key={level}
                  className={cn(
                    HOLDER_ITEM_CLASS,
                    "px-3 py-2",
                    // A critical count above zero is the one tile to act on first.
                    level === "critical" &&
                      alerts.critical > 0 &&
                      "border-foreground",
                  )}
                >
                  <dt className="text-muted-foreground text-sm">{t(level)}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {format.number(alerts[level])}
                  </dd>
                </div>
              ),
            )}
          </dl>
          {alerts.items.length ? (
            <ul className={cn(HOLDER_CLASS, "space-y-2")}>
              {alerts.items.map((row) => (
                <li
                  key={row.id}
                  className={cn(HOLDER_ITEM_CLASS, "space-y-2 p-3")}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {/* Three looks for three levels: solid critical, gray warning, outlined information. */}
                    <Badge
                      variant={
                        row.severity === "critical"
                          ? "destructive"
                          : row.severity === "warning"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {t(row.severity)}
                    </Badge>
                    <time
                      dateTime={row.at.toISOString()}
                      className="text-muted-foreground text-sm"
                    >
                      {format.dateTime(row.at, "dateTimeMedium")}
                    </time>
                    {row.taskId && (
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="ms-auto max-sm:h-10"
                      >
                        <Link
                          href={`/admin/tasks/${encodeURIComponent(row.taskId)}`}
                        >
                          {t("openTask")}
                        </Link>
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <Reference
                      label={t(
                        row.auditId
                          ? "auditId"
                          : row.projectId
                            ? "projectId"
                            : "recordId",
                      )}
                      value={row.auditId ?? row.projectId ?? row.id}
                    />
                    {row.workspaceId && (
                      <Reference
                        label={t("workspaceId")}
                        value={row.workspaceId}
                        href={workspaceHref(row)}
                      />
                    )}
                  </div>
                  <ul className="list-disc space-y-1 ps-5 text-sm">
                    {row.reasons.map((reason) => (
                      <li key={reason}>
                        {t(`reason.${reason}`, {
                          failed: row.failedPages,
                          attempted: row.attemptedPages,
                          minutes: alerts.importGraceMinutes,
                        })}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              {t(total ? "emptyPage" : "empty")}
            </p>
          )}
        </>
      )}
      {(page > 1 || page * alerts.pageSize < total) && (
        <nav aria-label={t("pagination")} className="flex gap-2">
          {page > 1 && (
            <Button asChild variant="outline">
              <Link href={listHref(period, page - 1, view)}>
                {t("previous")}
              </Link>
            </Button>
          )}
          {page * alerts.pageSize < total && (
            <Button asChild variant="outline" className="ms-auto">
              <Link href={listHref(period, page + 1, view)}>{t("next")}</Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
