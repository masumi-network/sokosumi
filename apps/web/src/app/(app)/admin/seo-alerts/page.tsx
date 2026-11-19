import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { readAdminSeoAlerts } from "@/lib/services/admin-seo-alerts.service";

export const instant = false;
const periods = ["7", "30", "90", "all"] as const;
function listHref(period: string, page = 1, connections = false) {
  const query = new URLSearchParams({ period });
  if (connections) query.set("view", "connections");
  if (page > 1) query.set("page", String(page));
  return `/admin/seo-alerts?${query}`;
}

export default async function AdminSeoAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; page?: string; view?: string }>;
}) {
  const params = await searchParams;
  const connections = params.view === "connections";
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
      ...(connections && { view: "connections" }),
    }),
    getTranslations("App.Admin.SeoAlerts"),
    getFormatter(),
  ]);
  const total = connections ? alerts.connectionTotal : alerts.total;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-2">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <nav aria-label={t("type")} className="flex flex-wrap gap-4">
        <Link
          href={listHref(period)}
          aria-current={connections ? undefined : "page"}
          className="underline"
        >
          {t("auditTab", { count: alerts.total })}
        </Link>
        <Link
          href={listHref(period, 1, true)}
          aria-current={connections ? "page" : undefined}
          className="underline"
        >
          {t("connectionTab", { count: alerts.connectionTotal })}
        </Link>
      </nav>
      {connections ? (
        <>
          <p className="text-muted-foreground text-sm">
            {t("connectionDescription")}
          </p>
          {alerts.connections.length ? (
            <ul className="divide-y rounded-lg border">
              {alerts.connections.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-3 p-4"
                >
                  <Badge variant="secondary">
                    {t(
                      row.status === "NEEDS_RECONNECT"
                        ? "reconnect"
                        : "disconnected",
                    )}
                  </Badge>
                  <span>{t(row.provider)}</span>
                  <time
                    dateTime={row.at.toISOString()}
                    className="text-muted-foreground text-sm"
                  >
                    {format.dateTime(row.at, "dateTimeMedium")}
                  </time>
                  <Link
                    href={`/admin/users/${encodeURIComponent(row.userId)}`}
                    className="text-sm underline"
                  >
                    {t("openAccount")}
                  </Link>
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
          <nav aria-label={t("period")} className="flex flex-wrap gap-4">
            {periods.map((value) => (
              <Link
                key={value}
                href={listHref(value)}
                aria-current={period === value ? "page" : undefined}
                className={
                  period === value
                    ? "font-semibold underline"
                    : "text-muted-foreground underline"
                }
              >
                {value === "all"
                  ? t("all")
                  : t("days", { days: Number(value) })}
              </Link>
            ))}
          </nav>
          <dl className="flex flex-wrap gap-6">
            {(["total", "critical", "warning", "info"] as const).map(
              (level) => (
                <div key={level}>
                  <dt className="text-muted-foreground text-sm">{t(level)}</dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {format.number(alerts[level])}
                  </dd>
                </div>
              ),
            )}
          </dl>
          {alerts.items.length ? (
            <ul className="divide-y rounded-lg border">
              {alerts.items.map((row) => (
                <li key={row.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge
                      variant={
                        row.severity === "critical"
                          ? "destructive"
                          : "secondary"
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
                      <Link
                        href={`/admin/tasks/${encodeURIComponent(row.taskId)}`}
                        className="text-sm underline"
                      >
                        {t("openTask")}
                      </Link>
                    )}
                  </div>
                  <ul className="list-disc space-y-1 pl-5">
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
        <nav aria-label={t("pagination")} className="flex gap-4">
          {page > 1 && (
            <Link
              href={listHref(period, page - 1, connections)}
              className="underline"
            >
              {t("previous")}
            </Link>
          )}
          {page * alerts.pageSize < total && (
            <Link
              href={listHref(period, page + 1, connections)}
              className="underline"
            >
              {t("next")}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
