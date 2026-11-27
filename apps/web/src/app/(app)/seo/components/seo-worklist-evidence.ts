import type {
  ProjectSeoAction,
  ProjectSeoStrategy,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import type { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import type { currentDiscoveryResult } from "./seo-audit-discovery";
import type { SeoActionBucket } from "./seo-overview-model";
import { type SeoPlace, seoPlaces } from "./seo-places-model";
import type { SeoPropertyPageFactsProps } from "./seo-property-page-discovery";
import { seoPageKey } from "./seo-serp-features-model";
import { SEO_VITAL_LIMITS } from "./seo-speed-model";

type StrategyAction = ProjectSeoStrategy["actions"][number];
export interface SeoEvidenceAction {
  key: string;
  kind: "evidence";
  bucket: SeoActionBucket;
  title: string;
  url?: string;
  facts: string[];
  strategy?: StrategyAction;
  place?: SeoPlace;
  property?: SeoPropertyPageFactsProps;
}

// A generic not_checked status also covers captures with no field record. Only replay
// a public lab recommendation when the audit explicitly recorded the CrUX skip.
const PUBLIC_FIELD_SKIP =
  /Chrome UX Report field data was not collected by this public audit|did not check whether Google has real-user data for this URL|CrUX\) are excluded from this public audit worker|public worker excludes CrUX/i;
const ACCESS_ROWS = new Set(["AC-01", "AC-03", "AC-05", "AC-06"]);
/** One key per page for a join: a home page with and without its root slash is one page. A row shows the URL as written. */
const page = (url?: string | null) =>
  url && URL.canParse(url) ? seoPageKey(url) : (url ?? "");

export function seoWorklistEvidence(
  workspace: ProjectSeoWorkspace,
  report: ReturnType<typeof currentDiscoveryResult>,
  saved: ProjectSeoAction[],
  t: ReturnType<typeof useSeoResultTranslations<"App.Seo">>,
) {
  const rows: SeoEvidenceAction[] = [];
  const keyOf = (title: string, url?: string) =>
    JSON.stringify([title.trim().toLowerCase(), page(url)]);
  const seen = new Set(saved.map((a) => keyOf(a.title, a.pageUrl)));
  function add(
    title: string,
    url: string | undefined,
    bucket: SeoActionBucket,
    facts: string[],
    extra?: Pick<SeoEvidenceAction, "strategy" | "place" | "property">,
  ) {
    const key = keyOf(title, url);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ key, kind: "evidence", bucket, title, url, facts, ...extra });
  }
  const speed = workspace.observations.find((row) => row.kind === "audit_full");
  for (const measurement of speed?.pageSpeed ?? []) {
    const { lab, device, pageUrl } = measurement;
    const measured = page(pageUrl);
    if (
      workspace.findings.some(
        (f) =>
          f.observationId === speed?.id &&
          page(f.pageUrl) === measured &&
          ACCESS_ROWS.has(f.rowId),
      ) ||
      measurement.field.status !== "not_checked" ||
      lab.status !== "measured" ||
      lab.median.lcp == null ||
      lab.median.lcp <= SEO_VITAL_LIMITS.lcp.good
    )
      continue;
    const skipped = speed?.checklistBreakdown?.gaps.some(
      (gap) =>
        page(gap.pageUrl) === measured &&
        gap.device === device &&
        ["EX-01", "EX-02", "EX-14"].includes(gap.rowId) &&
        PUBLIC_FIELD_SKIP.test(gap.reason),
    );
    const slowFinding = workspace.findings.some(
      (f) =>
        f.observationId === speed?.id &&
        page(f.pageUrl) === measured &&
        f.device === device &&
        f.rowId === "EX-14" &&
        f.evidence.some((line) => PUBLIC_FIELD_SKIP.test(line)),
    );
    const confirmed = Boolean(lab.pageSpeed && (skipped || slowFinding));
    const insight = lab.pageSpeed?.insights.find(
      (i) => i.id === "lcp-breakdown-insight",
    );
    const cited = new Set(
      saved
        .filter(
          (a) => page(a.pageUrl) === measured && a.observationId === speed?.id,
        )
        .flatMap((a) => a.findingIds),
    );
    if (
      workspace.findings.some(
        (f) =>
          page(f.pageUrl) === measured &&
          cited.has(f.id) &&
          f.rowId === "EX-14" &&
          (f.device === device ||
            (f.device === null &&
              f.evidence.some((line) => line.toLowerCase().includes(device)))),
      )
    )
      continue;
    add(
      confirmed
        ? t("planning.paint", { device: t(`breakdown.devices.${device}`) })
        : t(
            device === "mobile"
              ? "planning.retestMobile"
              : "planning.retestDesktop",
          ),
      pageUrl,
      !confirmed
        ? "suggestions"
        : lab.median.lcp > SEO_VITAL_LIMITS.lcp.poor
          ? "high"
          : "low",
      [
        t("planning.labLcp", { seconds: lab.median.lcp / 1000 }),
        ...(insight ? [insight.detail, insight.action] : [t("planning.trace")]),
        t("planning.retest", { device: t(`breakdown.devices.${device}`) }),
      ],
    );
  }
  for (const item of report?.discovery?.actions ?? [])
    add(item.action, item.url, "suggestions", [item.evidence]);
  if (report?.pageDiscovery)
    for (const page of report.pageDiscovery.pages) {
      if (page.suggestion)
        add(page.suggestion, page.pageUrl, "suggestions", [], {
          property: { report, page },
        });
    }
  for (const item of workspace.siteEvidence?.targets ?? [])
    if (item.status !== "observed")
      add(
        item.action,
        item.targetUrl,
        item.status === "fix_link" ? "high" : "suggestions",
        [
          item.httpStatus == null
            ? t("siteEvidence.unverified")
            : t("siteEvidence.response", { status: item.httpStatus }),
          ...(item.finalUrl && item.finalUrl !== item.targetUrl
            ? [item.finalUrl]
            : []),
        ],
      );
  const { rest, places } = seoPlaces(workspace.strategy?.actions ?? []);
  for (const strategy of rest)
    add(strategy.title, undefined, "suggestions", [], { strategy });
  for (const place of places)
    add(
      place.task
        ? t(`strategy.links.task.${place.task}`, { site: place.name })
        : place.name,
      place.action.place?.url ?? place.action.targets[0]?.url,
      "suggestions",
      [],
      { strategy: place.action, place },
    );
  return rows;
}
