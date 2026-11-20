import type { ProjectSeoObservation } from "@sokosumi/database";
import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import { googleReturnedUnknown } from "@/lib/seo/inspection-provenance";
import { seoPageComparisonKey as key } from "@/lib/seo/related-page-selection";
import type {
  ProjectSeoWorkspace,
  SeoWorkspaceQuery,
} from "@/schemas/project-seo.schema";
import {
  SEO_DECLINE_DATES,
  SEO_DECLINE_DONOR_LIMIT,
  SEO_SITE_HISTORY_LIMIT,
  type SeoSiteEvidence,
  storedSiteEvidenceSchema,
} from "@/schemas/seo-site-evidence.schema";
import { matchesSeoPeriod } from "./project-seo-store";
import { storedReceiptSchema } from "./seo-task-indexing-receipt";

function cohort(urls: string[]) {
  return JSON.stringify(urls.map(key).sort());
}

function sources(evidence: SeoSiteEvidence, target: string) {
  const donors = new Map<string, string>();
  const content = new Map<string, string>();
  const sitemaps = new Map<string, string>();
  for (const item of evidence.observations) {
    const sourceKey = key(item.sourceUrl);
    if (key(item.targetUrl) !== key(target) || sourceKey === key(target))
      continue;
    if (item.sourceKind === "sitemap") sitemaps.set(sourceKey, item.sourceUrl);
    else {
      donors.set(sourceKey, item.sourceUrl);
      if (item.location === "content") content.set(sourceKey, item.sourceUrl);
    }
  }
  return {
    donorUrls: [...donors.values()],
    contentDonorUrls: [...content.values()],
    sitemapUrls: [...sitemaps.values()],
  };
}

function sameScope(a: ProjectSeoObservation, b: ProjectSeoObservation) {
  return (
    a.ownerId === b.ownerId &&
    a.projectId === b.projectId &&
    a.auditId === b.auditId &&
    a.scopeVersion === b.scopeVersion &&
    JSON.stringify(a.pageIds.toSorted()) ===
      JSON.stringify(b.pageIds.toSorted())
  );
}

function recommendation(
  target: string,
  links: ReturnType<typeof sources>,
  complete: boolean,
  sampled: string[],
  response?: NonNullable<SeoSiteEvidence["responses"]>[number],
  googleReason?: string,
) {
  const donor = links.donorUrls[0];
  const sitemap = links.sitemapUrls[0];
  if (response && [404, 410].includes(response.status)) {
    if (donor || sitemap)
      return {
        status: "fix_link" as const,
        action: `Review ${donor ?? sitemap}. Its ${donor ? "link" : "sitemap entry"} points to ${target}, which returned HTTP ${response.status}. Restore the page or update that source.`,
      };
    return {
      status: "review" as const,
      action: `Check whether ${target} should exist. It returned HTTP ${response.status}.`,
    };
  }
  if (response && [301, 302, 303, 307, 308].includes(response.status))
    return {
      status: "review_redirect" as const,
      action:
        donor || sitemap
          ? `Confirm the redirect is intentional. If so, update ${donor ?? sitemap} to point directly to the verified destination.`
          : "Confirm the redirect destination is intentional. A redirect alone does not require restoring the old page.",
    };
  if (response && (response.status < 200 || response.status >= 300))
    return {
      status: "review" as const,
      action: `Recheck ${target} before changing its sources. The request returned HTTP ${response.status}.`,
    };
  if (googleReason && /not found|soft 404|redirect/i.test(googleReason))
    return {
      status: "review" as const,
      action: response
        ? "Compare Google's recorded crawl with the current response before changing this URL."
        : "Check the current HTTP response before acting on Google's recorded crawl.",
    };
  const possibleDonor = sampled.find((url) => key(url) !== key(target));
  if (
    complete &&
    possibleDonor &&
    !links.contentDonorUrls.length &&
    response &&
    response.status === 200
  )
    return {
      status: "strengthen_links" as const,
      action: donor
        ? `Review the existing link on ${donor}. Check whether its placement and label help readers find ${target}.`
        : `No link was observed in these sampled pages. If ${target} helps readers of ${possibleDonor}, consider linking to it there.`,
    };
  return {
    status: "observed" as const,
    action: donor
      ? `Review the recorded link from ${donor} when editing this page.`
      : "Use this sample as a baseline. More page evidence is needed before proposing a link change.",
  };
}

type SampledDonors = { at: string; donors: string[] };

/** Only the newest complete reading per UTC day contributes to a sustained decline. */
function compareDonors(
  history: Map<string, SampledDonors[]>,
  cohortKey: string,
  at: string,
  donors: string[],
): NonNullable<
  ProjectSeoWorkspace["siteEvidence"]
>["targets"][number]["trend"] {
  const previous = history.get(cohortKey) ?? [];
  const last = previous.at(-1);
  const readings = [
    ...previous.filter((item) => item.at.slice(0, 10) !== at.slice(0, 10)),
    { at, donors },
  ].slice(-SEO_DECLINE_DATES);
  history.set(cohortKey, readings);
  if (!last || last.at >= at) return;
  const trend = {
    previousAt: last.at,
    previousCount: last.donors.length,
    currentCount: donors.length,
  };
  const [first, middle, current] = readings;
  if (
    !first ||
    !middle ||
    !current ||
    first.donors.length <= middle.donors.length ||
    middle.donors.length <= current.donors.length
  )
    return trend;
  const observed = new Set(donors.map(key));
  const missing = new Map<string, string>();
  for (const url of [...middle.donors, ...first.donors])
    if (!observed.has(key(url))) missing.set(key(url), url);
  return {
    ...trend,
    decline: {
      points: readings.map((item) => ({
        at: item.at,
        count: item.donors.length,
      })),
      missingDonorUrls: [...missing.values()].slice(0, SEO_DECLINE_DONOR_LIMIT),
    },
  };
}

export function projectSiteEvidence(
  rows: ProjectSeoObservation[],
  selected: Set<string>,
  query: SeoWorkspaceQuery,
): Pick<ProjectSeoWorkspace, "siteEvidence" | "auditSiteEvidence"> {
  const publicAudits = new Map<string, string[]>();
  const receipts = new Map<string, ProjectSeoObservation>();
  const snapshots = rows
    .flatMap((row) => {
      const taskId = row.sourceTaskId;
      if (!taskId) return [];
      if (
        row.kind === "audit_full" &&
        !row.ownerId &&
        matchesSeoPeriod(row.observedAt, query)
      ) {
        const report = publicSeoPayloadSchema.safeParse(row.payload);
        if (
          report.success &&
          report.data.pageUrls.some((url) => selected.has(url)) &&
          !publicAudits.has(taskId)
        )
          publicAudits.set(taskId, report.data.pageUrls);
      }
      if (
        row.kind === "index_inspection" &&
        row.source === "search_console" &&
        row.visibility === "PRIVATE" &&
        !receipts.has(taskId)
      )
        receipts.set(taskId, row);
      if (
        row.kind !== "site_evidence" ||
        row.source !== "seo_worker" ||
        row.visibility !== "PRIVATE" ||
        !row.ownerId
      )
        return [];
      const parsed = storedSiteEvidenceSchema.safeParse(row.payload);
      return parsed.success && selected.has(parsed.data.auditPageUrl)
        ? [{ row, taskId, data: parsed.data }]
        : [];
    })
    .sort((a, b) => a.row.observedAt.getTime() - b.row.observedAt.getTime());
  const baselines = new Map<string, SampledDonors[]>();
  const projected = new Map<
    string,
    NonNullable<ProjectSeoWorkspace["siteEvidence"]>
  >();
  for (const { row, taskId, data } of snapshots) {
    const candidate = receipts.get(taskId);
    const receiptRow =
      candidate && sameScope(candidate, row) ? candidate : undefined;
    const parsed = storedReceiptSchema.safeParse(receiptRow?.payload);
    const receipt =
      parsed.success &&
      parsed.data.receipt.taskId === row.sourceTaskId &&
      parsed.data.receipt.receiptHash === receiptRow?.artifactHash &&
      (parsed.data.receipt.auditPageUrl ??
        parsed.data.receipt.pages[0]?.pageUrl) === data.auditPageUrl
        ? parsed.data
        : null;
    const { evidence } = data;
    const cohortKey =
      evidence.complete && evidence.sampledPages.length
        ? JSON.stringify([
            row.ownerId,
            row.projectId,
            row.auditId,
            row.scopeVersion,
            row.pageIds.toSorted(),
            data.auditPageUrl,
            cohort(evidence.sampledPages),
          ])
        : null;
    const observedAt = row.observedAt.toISOString();
    const version = {
      taskId,
      auditPageUrl: data.auditPageUrl,
      observedAt,
      sampledPages: evidence.sampledPages,
      complete: evidence.complete,
      targets: data.targetUrls.map((targetUrl) => {
        const links = sources(evidence, targetUrl);
        const inspection = receipt?.receipt.pages.find(
          (page) => key(page.pageUrl) === key(targetUrl),
        );
        const examples = receipt?.discoverySources?.find(
          (entry) => inspection && entry.pageUrl === inspection.pageUrl,
        );
        const googleReason =
          receipt &&
          inspection &&
          (inspection.verdict !== "VERDICT_UNSPECIFIED" ||
            googleReturnedUnknown(receipt, inspection))
            ? (inspection.coverageState ?? inspection.verdict)
            : undefined;
        const response = evidence.responses?.find(
          (entry) => key(entry.pageUrl) === key(targetUrl),
        );
        const baselineKey =
          cohortKey && JSON.stringify([cohortKey, key(targetUrl)]);
        const trend = baselineKey
          ? compareDonors(baselines, baselineKey, observedAt, links.donorUrls)
          : undefined;
        const advice = recommendation(
          targetUrl,
          links,
          evidence.complete,
          evidence.sampledPages,
          response,
          googleReason,
        );
        if (
          trend?.decline &&
          response?.status === 200 &&
          (advice.status === "observed" || advice.status === "strengthen_links")
        ) {
          advice.status = "strengthen_links";
          advice.action = `Review ${trend.decline.missingDonorUrls[0]}. It previously linked to ${targetUrl}. If that link still helps readers, restore it.`;
        }
        return {
          targetUrl,
          ...links,
          ...advice,
          ...(response && {
            httpStatus: response.status,
            finalUrl: response.finalUrl,
          }),
          ...(examples?.referringPages && {
            googleReferringPages: examples.referringPages,
          }),
          ...(examples?.reportedSitemaps && {
            googleSitemapUrls: examples.reportedSitemaps,
          }),
          ...(googleReason &&
            inspection &&
            receipt && {
              googleReason,
              googleCheckedAt:
                receipt.reusedCheckedAt?.[inspection.pageUrl] ??
                receipt.receipt.checkedAt,
            }),
          ...(trend && { trend }),
        };
      }),
    };
    if (publicAudits.get(taskId)?.includes(data.auditPageUrl))
      projected.set(taskId, version);
  }
  const ids = [...publicAudits.keys()];
  return {
    siteEvidence: projected.get(ids[0] ?? "") ?? null,
    auditSiteEvidence: ids
      .slice(0, SEO_SITE_HISTORY_LIMIT)
      .flatMap((id) => projected.get(id) ?? []),
  };
}
