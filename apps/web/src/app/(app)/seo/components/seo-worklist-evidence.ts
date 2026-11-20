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

export const GOOD_LAB_LCP_MS = 2500;
const POOR_LCP_MS = 4000;
const ACCESS_ROWS = new Set(["AC-01", "AC-03", "AC-05", "AC-06"]);

export function seoWorklistEvidence(
  workspace: ProjectSeoWorkspace,
  report: ReturnType<typeof currentDiscoveryResult>,
  saved: ProjectSeoAction[],
  t: ReturnType<typeof useSeoResultTranslations<"App.Seo">>,
) {
  const rows: SeoEvidenceAction[] = [];
  const keyOf = (title: string, url?: string) =>
    JSON.stringify([title.trim().toLowerCase(), url ?? ""]);
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
    if (
      workspace.findings.some(
        (f) =>
          f.observationId === speed?.id &&
          f.pageUrl === pageUrl &&
          ACCESS_ROWS.has(f.rowId),
      ) ||
      measurement.field.status !== "not_checked" ||
      lab.status !== "measured" ||
      !lab.pageSpeed ||
      lab.median.lcp == null ||
      lab.median.lcp <= GOOD_LAB_LCP_MS
    )
      continue;
    const insight = lab.pageSpeed?.insights.find(
      (i) => i.id === "lcp-breakdown-insight",
    );
    const cited = new Set(
      saved
        .filter((a) => a.pageUrl === pageUrl && a.observationId === speed?.id)
        .flatMap((a) => a.findingIds),
    );
    if (
      workspace.findings.some(
        (f) =>
          f.pageUrl === pageUrl &&
          cited.has(f.id) &&
          f.rowId === "EX-14" &&
          (f.device === device ||
            (f.device === null &&
              f.evidence.some((line) => line.toLowerCase().includes(device)))),
      )
    )
      continue;
    add(
      t("planning.paint", { device: t(`breakdown.devices.${device}`) }),
      pageUrl,
      lab.median.lcp > POOR_LCP_MS ? "high" : "low",
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
