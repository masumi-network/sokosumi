import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoDate, SeoFoldSummary } from "./seo-shared";

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

function Metrics({
  keys,
  values,
}: {
  keys: readonly Metric[];
  values: Partial<Record<Metric, number | null>>;
}) {
  const t = useSeoResultTranslations("App.Seo.pageSpeed");
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2">
      {keys.map((key) => {
        const value = values[key];
        return value == null ? null : (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">
              {t(`metricsTitle.${key}`)}
            </dt>
            <dd className="tabular-nums">{formattedMetric(key, value)}</dd>
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
        <div>
          <p className="text-xs text-muted-foreground">{t("scores")}</p>
          <dl className="flex flex-wrap gap-x-4">
            {scores.map(
              (key) =>
                report.scores[key] != null && (
                  <div key={key} className="flex gap-1">
                    <dt>{t(`score.${key}`)}</dt>
                    <dd className="tabular-nums">{report.scores[key]}</dd>
                  </div>
                ),
            )}
          </dl>
        </div>
      )}
      {report && report.insights.length > 0 && (
        <div>
          <h5 className="font-medium">{t("insights")}</h5>
          <ul className="list-disc space-y-2 ps-5">
            {report.insights.map((insight) => (
              <li key={insight.id}>
                <p className="font-medium">{insight.title}</p>
                <p>{insight.detail}</p>
                {insight !== report.insights[0] && <p>{insight.action}</p>}
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
}: {
  rows: Row[] | undefined;
  at: Date | string;
}) {
  const t = useSeoResultTranslations("App.Seo");
  if (!rows?.length) return null;
  return (
    <section
      lang="en"
      aria-label={t("pageSpeed.title")}
      className="mt-4 min-w-0 space-y-2 text-sm"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold">{t("pageSpeed.title")}</h3>
        <span className="text-xs text-muted-foreground">
          {t("pageSpeed.date")} <SeoDate report day value={at} />
        </span>
      </div>
      {Array.from(
        Map.groupBy(rows, (row) => row.pageUrl),
        ([url, devices]) => (
          <div key={url}>
            <p className="break-all font-medium">{url}</p>
            {devices.map(({ testedUrl, device, lab, field }) => (
              <details key={device} className="border-b py-2">
                <SeoFoldSummary>
                  {t(`breakdown.devices.${device}`)} ·{" "}
                  {lab.status === "measured" && lab.pageSpeed?.insights[0]
                    ? lab.pageSpeed.insights[0].action
                    : lab.status === "measured" && lab.median.lcp !== null
                      ? "LCP " + formattedMetric("lcp", lab.median.lcp)
                      : lab.status === "measured"
                        ? t("pageSpeed.lab")
                        : t(`pageSpeed.${lab.status}`)}
                </SeoFoldSummary>
                <div className="mt-2 min-w-0 space-y-3 ps-2">
                  {testedUrl !== url && (
                    <p className="break-all">{testedUrl}</p>
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
