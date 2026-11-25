import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoDate, SeoFoldSummary, SeoPeriod } from "./seo-shared";
import {
  isSeoVital,
  SEO_VITAL_LIMITS,
  type SeoSpeedDevice,
  type SeoSpeedMetric,
  seoDeviceVerdict,
  seoPageVerdict,
  seoSpeedDay,
  seoSpeedValue,
  seoVitalStatus,
} from "./seo-speed-model";
import { SeoSpeedMark, seoSpeedVerdictText } from "./seo-speed-status";

type Row = SeoSpeedDevice;
// The Core Web Vitals lead each list: they have a status, the other values are detail.
const labMetrics = ["lcp", "cls", "fcp", "tbt", "si"] as const;
const fieldMetrics = ["lcp", "inp", "cls", "fcp", "ttfb"] as const;
const scores = [
  "performance",
  "accessibility",
  "bestPractices",
  "seo",
  "agenticBrowsing",
] as const;

/** The closed research row: the verdict of the one page, or how many pages the audit holds. */
export function pageSpeedSummary(
  rows: Row[],
  t: ReturnType<typeof useSeoResultTranslations<"App.Seo">>,
) {
  const pages = new Set(rows.map((row) => row.pageUrl));
  if (pages.size === 1) {
    const page = seoPageVerdict(rows);
    if (page.source)
      return `${seoSpeedVerdictText(t, page)} · ${t(`pageSpeed.source.${page.source}`)}`;
  }
  return t("pages.count", { count: pages.size });
}

function Metrics({
  keys,
  values,
}: {
  keys: readonly SeoSpeedMetric[];
  values: Partial<Record<SeoSpeedMetric, number | null>>;
}) {
  const t = useSeoResultTranslations("App.Seo.pageSpeed");
  return (
    <dl className="grid gap-x-5 gap-y-4 rounded-lg bg-muted p-4 sm:grid-cols-3">
      {keys.map((key) => {
        const value = values[key] ?? null;
        const vital = isSeoVital(key) ? key : null;
        // A Core Web Vital without a value stays in the list and says so; another value without data is left out.
        if (value == null && !vital) return null;
        return (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">
              {t(`metricsTitle.${key}`)}
            </dt>
            <dd className="mt-1 space-y-1">
              {value != null && (
                <span className="block text-base font-semibold tabular-nums">
                  {seoSpeedValue(key, value)}
                </span>
              )}
              {vital && (
                <>
                  <span className="block">
                    <SeoSpeedMark status={seoVitalStatus(vital, value)} />
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {t("limit", {
                      good: seoSpeedValue(vital, SEO_VITAL_LIMITS[vital].good),
                      poor: seoSpeedValue(vital, SEO_VITAL_LIMITS[vital].poor),
                    })}
                  </span>
                </>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Lab({ lab, leads }: { lab: Row["lab"]; leads: boolean }) {
  const t = useSeoResultTranslations("App.Seo.pageSpeed");
  if (lab.status !== "measured") return <p>{t(lab.status)}</p>;
  const report = lab.pageSpeed;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {lab.ok === 1 && lab.runs === 1
          ? t("single")
          : t("multiple", { ok: lab.ok, runs: lab.runs })}
        {lab.lighthouse && (
          <> · {t("labVersion", { version: lab.lighthouse })}</>
        )}
        {report?.measuredAt && (
          <>
            {" "}
            · <SeoDate report value={report.measuredAt} />
          </>
        )}
      </p>
      <p className="max-w-prose text-xs text-muted-foreground">
        {t("labNote")}
        {/* Only where the lab test decides the verdict: there the missing INP is a gap of the verdict. */}
        {leads && <> {t("labNoInp")}</>}
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
                    {/* The first check to make is on the device line, so it is not said twice. */}
                    {insight !== report.insights[0] && <p>{insight.action}</p>}
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

function Field({ field }: { field: Row["field"] }) {
  const t = useSeoResultTranslations("App.Seo.pageSpeed");
  if (field.status !== "measured") return <p>{t(field.status)}</p>;
  const first = field.period && seoSpeedDay(field.period.first);
  const last = field.period && seoSpeedDay(field.period.last);
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {t("p75")}
        {first && last && (
          <>
            {" "}
            · <SeoPeriod report from={first} to={last} />
          </>
        )}
      </p>
      {field.level !== "url" && (
        <>
          <p className="max-w-prose">{t(`caveat.${field.level}`)}</p>
          <p className="break-all text-xs text-muted-foreground">{field.url}</p>
        </>
      )}
      <Metrics keys={fieldMetrics} values={field.p75} />
    </>
  );
}

/** One page's speed, a fold per device. The block that decided the device's verdict stands first in the fold. */
export function SeoSpeedDetail({
  pageUrl,
  devices,
}: {
  pageUrl: string;
  devices: Row[];
}) {
  const t = useSeoResultTranslations("App.Seo");
  return (
    <div className="min-w-0">
      <p className="mb-3 max-w-prose text-xs text-muted-foreground">
        {t("pageSpeed.vitals")}
      </p>
      {devices.map((row) => {
        const { testedUrl, device, lab, field } = row;
        const verdict = seoDeviceVerdict(row);
        const labLeads = verdict.source === "lab";
        const blocks = [
          <div key="field" className="space-y-2">
            <h4 className="font-medium">{t("pageSpeed.field")}</h4>
            <Field field={field} />
          </div>,
          <div key="lab" className="space-y-2">
            <h4 className="font-medium">{t("pageSpeed.lab")}</h4>
            <Lab lab={lab} leads={labLeads} />
          </div>,
        ];
        return (
          <details key={device} className="border-t">
            <SeoFoldSummary className="min-h-12 gap-3 py-2 font-medium tabular-nums">
              <span className="min-w-0 flex-1">
                {t(`breakdown.devices.${device}`)} ·{" "}
                {verdict.source ? (
                  <>
                    {t(`pageSpeed.source.${verdict.source}`)} ·{" "}
                    {seoSpeedVerdictText(t, verdict)}
                  </>
                ) : lab.status === "measured" ? (
                  t("pageSpeed.status.too_little_data")
                ) : (
                  t(`pageSpeed.${lab.status}`)
                )}
                {/* The change to investigate leads; the measurements are below the fold. */}
                {lab.status === "measured" && lab.pageSpeed?.insights[0] && (
                  <span className="block font-normal text-muted-foreground">
                    {lab.pageSpeed.insights[0].action}
                  </span>
                )}
              </span>
            </SeoFoldSummary>
            <div className="min-w-0 space-y-5 pb-5">
              {testedUrl !== pageUrl && (
                <p className="break-all text-xs text-muted-foreground">
                  {testedUrl}
                </p>
              )}
              {labLeads ? blocks.reverse() : blocks}
            </div>
          </details>
        );
      })}
    </div>
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
            <SeoSpeedDetail pageUrl={url} devices={devices} />
          </div>
        ),
      )}
    </section>
  );
}
