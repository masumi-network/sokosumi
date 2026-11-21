import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoFoldSummary, SeoPageLink, seoPagePath } from "./seo-shared";

import { sitemapDraftXml } from "./seo-sitemap-model";

type SiteEvidence = NonNullable<ProjectSeoWorkspace["siteEvidence"]>;

const day = (date: Date | string) => new Date(date).toISOString().slice(0, 10);

export function SeoSiteEvidence({
  evidence,
  embedded = false,
}: {
  evidence: SiteEvidence;
  embedded?: boolean;
}) {
  const t = useSeoResultTranslations("App.Seo.siteEvidence");
  const sitemapDraft = sitemapDraftXml(evidence.targets);
  const actionable = evidence.targets.filter(
    (target) => target.status !== "observed",
  );
  const routine = evidence.targets.filter(
    (target) => target.status === "observed",
  );
  return (
    <section lang="en" className="min-w-0 space-y-4 text-sm">
      {!embedded && <h3 className="font-semibold">{t("heading")}</h3>}
      <p>
        {t("coverage", {
          date: day(evidence.observedAt),
          pages: evidence.sampledPages.length,
          targets: evidence.targets.length,
        })}
      </p>
      {evidence.suppliedSitemap && (
        <p>{t(`suppliedSitemap_${evidence.suppliedSitemap}`)}</p>
      )}
      {sitemapDraft && (
        <a
          className="inline-block text-sm underline underline-offset-4"
          download="sitemap-draft.xml"
          href={`data:application/xml;charset=utf-8,${encodeURIComponent(sitemapDraft)}`}
        >
          {t("downloadSitemap")}
        </a>
      )}
      {evidence.coverage && (
        <div className="space-y-3">
          <dl className="grid grid-cols-3 gap-3 rounded-lg bg-muted px-4 py-3">
            {(
              [
                ["eligible", evidence.coverage.discovered],
                [
                  "verified",
                  evidence.coverage.discovered -
                    evidence.coverage.deferredCount,
                ],
                ["deferredCount", evidence.coverage.deferredCount],
              ] as const
            ).map(([label, count]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{t(label)}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {count}
                </dd>
              </div>
            ))}
          </dl>
          {evidence.coverage.deferred.length > 0 && (
            <details>
              <SeoFoldSummary className="min-h-9 font-medium">
                {t("deferred", { count: evidence.coverage.deferred.length })}
              </SeoFoldSummary>
              <ul className="space-y-3">
                {evidence.coverage.deferred.map((lead) => (
                  <li key={lead.url}>
                    <SeoPageLink url={lead.url} /> {t(`reasons.${lead.reason}`)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {!evidence.complete && <p>{t("partial")}</p>}
      {evidence.sampledPages.length > 0 && (
        <details>
          <SeoFoldSummary className="min-h-9 font-medium">
            {t("sampledPages")}
          </SeoFoldSummary>
          <ul>
            {evidence.sampledPages.map((url) => (
              <li key={url}>
                <SeoPageLink url={url} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {actionable.length > 0 && (
        <TargetList evidence={evidence} targets={actionable} />
      )}
      {routine.length > 0 &&
        (actionable.length && embedded ? (
          <details>
            <SeoFoldSummary className="min-h-10 font-medium">
              {t("otherTargets", { count: routine.length })}
            </SeoFoldSummary>
            <TargetList evidence={evidence} targets={routine} />
          </details>
        ) : (
          <TargetList evidence={evidence} targets={routine} />
        ))}
    </section>
  );
}

function TargetList({
  evidence,
  targets,
}: {
  evidence: SiteEvidence;
  targets: SiteEvidence["targets"];
}) {
  const t = useSeoResultTranslations("App.Seo.siteEvidence");
  const google = useSeoResultTranslations("App.Seo.discovery");
  return (
    <ul className="divide-y">
      {targets.map((target) => (
        <li key={target.targetUrl}>
          <details>
            <SeoFoldSummary className="min-h-12 gap-4 px-2 py-2 sm:px-3">
              <span className="min-w-0 flex-1 break-all font-medium" dir="auto">
                {seoPagePath(target.targetUrl, evidence.auditPageUrl) ??
                  target.targetUrl}
              </span>
              <span className="flex shrink-0 flex-col items-end text-xs text-muted-foreground">
                <span>
                  {target.httpStatus == null
                    ? t("unknownResponse")
                    : `HTTP ${target.httpStatus}`}
                </span>
                {evidence.sampledPages.length > 0 && (
                  <span>
                    {t("linkingPages", { count: target.donorUrls.length })}
                  </span>
                )}
              </span>
            </SeoFoldSummary>
            <div className="space-y-3 rounded-md bg-muted p-4">
              <SeoPageLink url={target.targetUrl} />
              <p className="font-medium">{target.action}</p>

              {target.finalUrl && target.finalUrl !== target.targetUrl && (
                <p>
                  {t("destination")} <SeoPageLink url={target.finalUrl} />
                </p>
              )}
              {target.googleReason && (
                <p>
                  {t("google", { reason: target.googleReason })}{" "}
                  {target.googleCheckedAt && day(target.googleCheckedAt)}
                </p>
              )}
              {target.trend?.decline ? (
                <div className="space-y-3">
                  <h4 className="font-medium">{t("decline")}</h4>
                  <ol>
                    {target.trend.decline.points.map((point) => (
                      <li key={day(point.at)}>
                        {t("linkCount", {
                          date: day(point.at),
                          count: point.count,
                        })}
                      </li>
                    ))}
                  </ol>
                  {target.trend.decline.missingDonorUrls.length > 0 && (
                    <>
                      <p>{t("lostDonors")}</p>
                      <ul aria-label={t("lostDonors")}>
                        {target.trend.decline.missingDonorUrls.map((url) => (
                          <li key={url}>
                            <SeoPageLink url={url} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ) : (
                <p>
                  {target.trend
                    ? t("trend", {
                        previous: target.trend.previousCount,
                        date: day(target.trend.previousAt),
                        current: target.trend.currentCount,
                      })
                    : !evidence.sampledPages.length
                      ? t("unknownDonors")
                      : t(evidence.complete ? "baseline" : "partialDonors", {
                          count: target.donorUrls.length,
                        })}
                </p>
              )}
              {target.donorUrls.length > 0 && (
                <details>
                  <SeoFoldSummary className="min-h-9 font-medium">
                    {t("donors")}
                  </SeoFoldSummary>
                  <ul>
                    {target.donorUrls.map((url) => (
                      <li key={url}>
                        <SeoPageLink url={url} />{" "}
                        {target.contentDonorUrls.includes(url) && t("content")}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {(
                [
                  [t("sitemaps"), target.sitemapUrls],
                  [google("referringPages"), target.googleReferringPages],
                  [google("reportedSitemaps"), target.googleSitemapUrls],
                ] as const
              ).map(([heading, urls]) =>
                urls?.length ? (
                  <details key={heading}>
                    <SeoFoldSummary className="min-h-9 font-medium">
                      {heading}
                    </SeoFoldSummary>
                    <ul>
                      {urls.map((url) => (
                        <li key={url}>
                          <SeoPageLink url={url} />
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null,
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
