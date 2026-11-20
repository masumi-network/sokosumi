import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoDate, SeoFoldSummary } from "./seo-shared";

import { GOOD_LAB_LCP_MS } from "./seo-worklist-evidence";

type Row = NonNullable<
  ProjectSeoWorkspace["observations"][number]["pageSpeed"]
>[number];
const labMetrics = ["lcp", "fcp", "tbt", "si", "cls"] as const;
const fieldMetrics = ["lcp", "inp", "cls", "fcp", "ttfb"] as const;
const scores = [
  "performance",
  "accessibility",
  "bestPractices",
  "seo",
  "agenticBrowsing",
] as const;
type Metric = (typeof labMetrics)[number] | (typeof fieldMetrics)[number];

function formattedMetric(key: Metric, value: number) {
  if (key === "cls")
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (key === "tbt" || key === "inp" || key === "ttfb")
    return value.toLocaleString("en-US", { maximumFractionDigits: 1 }) + " ms";
  return (
    (value / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " s"
  );
}

export function pageSpeedSummary(
  rows: Row[],
  t: ReturnType<typeof useSeoResultTranslations<"App.Seo">>,
) {
  const pages = new Set(rows.map((row) => row.pageUrl));
  if (pages.size === 1) {
    const timings = rows.flatMap(({ device, lab }) =>
      lab.status === "measured" && lab.median.lcp != null
        ? [
            t(`breakdown.devices.${device}`) +
              " LCP " +
              formattedMetric("lcp", lab.median.lcp),
          ]
        : [],
    );
    if (timings.length) return timings.join(" · ");
  }
  return t("pages.count", { count: pages.size });
}

function Metrics({
  keys,
  values,
}: {
  keys: readonly Metric[];
  values: Partial<Record<Metric, number | null>>;
}) {
  const t = useSeoResultTranslations("App.Seo.pageSpeed");
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-lg bg-muted/50 p-4 sm:grid-cols-3 lg:grid-cols-5">
      {keys.map((key) => {
        const value = values[key];
        return value == null ? null : (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">
              {t(`metricsTitle.${key}`)}
            </dt>
            <dd className="mt-1 text-base font-semibold tabular-nums">
              {formattedMetric(key, value)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Lab({ lab }: { lab: Row["lab"] }) {
  const t = useSeoResultTranslations("App.Seo.pageSpeed");
  if (lab.status !== "measured") return <p>{t(lab.status)}</p>;
  const report = lab.pageSpeed;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {lab.ok === 1 && lab.runs === 1
          ? t("single")
          : t("multiple", { ok: lab.ok, runs: lab.runs })}
        {lab.lighthouse && " · Lighthouse " + lab.lighthouse}
        {report?.measuredAt && (
          <>
            {" "}
            · <SeoDate report value={report.measuredAt} />
          </>
        )}
      </p>
      <Metrics keys={labMetrics} values={lab.median} />
      {report && scores.some((key) => report.scores[key] != null) && (
        <details>
          <SeoFoldSummary className="min-h-9 font-medium">
            {t("scores")}
          </SeoFoldSummary>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 py-3 sm:grid-cols-4">
            {scores.map(
              (key) =>
                report.scores[key] != null && (
                  <div key={key} className="grid gap-1">
                    <dt>{t(`score.${key}`)}</dt>
                    <dd className="tabular-nums">{report.scores[key]}</dd>
                  </div>
                ),
            )}
          </dl>
        </details>
      )}
      {report && report.insights.length > 0 && (
        <div>
          <h5 className="font-medium">{t("insights")}</h5>
          <ul className="mt-2 divide-y">
            {report.insights.map((insight) => (
              <li key={insight.id}>
                <details>
                  <SeoFoldSummary className="min-h-10 py-2">
                    {insight.title}
                  </SeoFoldSummary>
                  <div className="max-w-prose space-y-2 pb-3 text-muted-foreground">
                    <p>{insight.detail}</p>
                    <p>{insight.action}</p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function SeoPageSpeed({
  rows,
  at,
  embedded = false,
}: {
  rows: Row[] | undefined;
  at: Date | string;
  embedded?: boolean;
}) {
  const t = useSeoResultTranslations("App.Seo");
  if (!rows?.length) return null;
  return (
    <section
      lang="en"
      aria-label={t("pageSpeed.title")}
      className="min-w-0 space-y-4 text-sm"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        {!embedded && <h3 className="font-semibold">{t("pageSpeed.title")}</h3>}
        <span className="text-xs text-muted-foreground">
          {t("pageSpeed.date")} <SeoDate report day value={at} />
        </span>
      </div>
      {Array.from(
        Map.groupBy(rows, (row) => row.pageUrl),
        ([url, devices]) => (
          <div key={url}>
            <p className="mb-3 break-all text-sm font-medium">{url}</p>
            {devices.map(({ testedUrl, device, lab, field }) => (
              <details key={device} className="border-t">
                <SeoFoldSummary className="min-h-12 gap-3 py-2 font-medium tabular-nums">
                  <span className="min-w-0 flex-1">
                    {t(`breakdown.devices.${device}`)} ·{" "}
                    {lab.status === "measured" && lab.median.lcp !== null
                      ? "LCP " + formattedMetric("lcp", lab.median.lcp)
                      : lab.status === "measured"
                        ? t("pageSpeed.lab")
                        : t(`pageSpeed.${lab.status}`)}
                  </span>
                  {lab.status === "measured" && lab.median.lcp != null && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t(
                        lab.median.lcp > GOOD_LAB_LCP_MS
                          ? "pageSpeed.overTarget"
                          : "pageSpeed.withinTarget",
                      )}
                    </span>
                  )}
                </SeoFoldSummary>
                <div className="min-w-0 space-y-5 pb-5">
                  {testedUrl !== url && (
                    <p className="break-all text-xs text-muted-foreground">
                      {testedUrl}
                    </p>
                  )}
                  <div className="space-y-2">
                    <h4 className="font-medium">{t("pageSpeed.lab")}</h4>
                    <Lab lab={lab} />
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium">{t("pageSpeed.field")}</h4>
                    {field.status === "measured" ? (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {t(`pageSpeed.scope.${field.level}`)} ·{" "}
                          {t("pageSpeed.p75")}
                          {field.period && (
                            <>
                              {" "}
                              ·{" "}
                              <SeoDate
                                report
                                day
                                timeZone="UTC"
                                value={field.period.first}
                              />{" "}
                              to{" "}
                              <SeoDate
                                report
                                day
                                timeZone="UTC"
                                value={field.period.last}
                              />
                            </>
                          )}
                        </p>
                        {field.level !== "url" && (
                          <p className="break-all text-xs">{field.url}</p>
                        )}
                        <Metrics keys={fieldMetrics} values={field.p75} />
                      </>
                    ) : (
                      <p>{t(`pageSpeed.${field.status}`)}</p>
                    )}
                  </div>
                </div>
              </details>
            ))}
          </div>
        ),
      )}
    </section>
  );
}
