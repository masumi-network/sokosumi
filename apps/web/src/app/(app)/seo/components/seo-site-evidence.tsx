import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoFoldSummary, SeoPageLink, seoPagePath } from "./seo-shared";

import { sitemapDraftXml } from "./seo-sitemap-model";

type SiteEvidence = NonNullable<ProjectSeoWorkspace["siteEvidence"]>;

const day = (date: Date | string) => new Date(date).toISOString().slice(0, 10);

export function SeoSiteEvidence({ evidence }: { evidence: SiteEvidence }) {
  const t = useSeoResultTranslations("App.Seo.siteEvidence");
  const google = useSeoResultTranslations("App.Seo.discovery");
  const sitemapDraft = sitemapDraftXml(evidence.targets);
  return (
    <section lang="en" className="space-y-2 text-sm">
      <h3 className="font-semibold">{t("heading")}</h3>
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
          className="underline underline-offset-4"
          download="sitemap-draft.xml"
          href={`data:application/xml;charset=utf-8,${encodeURIComponent(sitemapDraft)}`}
        >
          {t("downloadSitemap")}
        </a>
      )}
      {evidence.coverage && (
        <div className="space-y-1">
          <p>
            {t("discovered", {
              count: evidence.coverage.discovered,
              checked:
                evidence.coverage.discovered - evidence.coverage.deferredCount,
              deferred: evidence.coverage.deferredCount,
            })}
          </p>
          {evidence.coverage.deferred.length > 0 && (
            <details>
              <SeoFoldSummary>
                {t("deferred", { count: evidence.coverage.deferred.length })}
              </SeoFoldSummary>
              <ul className="space-y-1">
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
          <SeoFoldSummary>{t("sampledPages")}</SeoFoldSummary>
          <ul>
            {evidence.sampledPages.map((url) => (
              <li key={url}>
                <SeoPageLink url={url} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <ul className="divide-y">
        {evidence.targets.map((target) => (
          <li key={target.targetUrl}>
            <details>
              <SeoFoldSummary className="min-h-11 gap-3 py-2">
                <span
                  className="min-w-0 flex-1 break-all font-medium"
                  dir="auto"
                >
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
              <div className="space-y-1 pb-3">
                <SeoPageLink url={target.targetUrl} />
                <p className="font-medium">{target.action}</p>
                <p>
                  {target.httpStatus != null
                    ? t("response", { status: target.httpStatus })
                    : t("unverified")}
                </p>
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
                  <div className="space-y-1">
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
                    <SeoFoldSummary>{t("donors")}</SeoFoldSummary>
                    <ul>
                      {target.donorUrls.map((url) => (
                        <li key={url}>
                          <SeoPageLink url={url} />{" "}
                          {target.contentDonorUrls.includes(url) &&
                            t("content")}
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
                      <SeoFoldSummary>{heading}</SeoFoldSummary>
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
    </section>
  );
}
