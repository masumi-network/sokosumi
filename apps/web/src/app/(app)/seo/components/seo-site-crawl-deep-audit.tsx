import type { ProjectSeoSiteCrawl } from "@sokosumi/core-client";
import type { ReactNode } from "react";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoSeverity } from "./seo-shared";
import { sentence } from "./seo-site-crawl-copy";

type DeepAudit = NonNullable<
  Extract<ProjectSeoSiteCrawl, { state: "crawled" }>["deepAudit"]
>;
/** Findings a page shows: the full list is in the page's own audit Report. */
const FIRST_FINDINGS = 5;
/** The levels that rank an issue: a note or a test shows with no level. */
const RANKED = new Set(["critical", "major", "minor"] as const);
const ranked = (severity: string): severity is "critical" | "major" | "minor" =>
  RANKED.has(severity as "critical");

/** The problem pages a crawl continuation audited in full, and the pages it picked but could not audit. */
export function SeoCrawlDeepAudit({
  audit,
  page,
}: {
  audit: DeepAudit;
  /** A URL as text, or as a button to the page's checks. */
  page: (url: string) => ReactNode;
}) {
  const t = useSeoResultTranslations("App.Seo.siteCrawl.next");
  if (!audit.pages.length && !audit.skipped.length) return null;
  return (
    <div className="space-y-3 px-2 pb-3 text-sm">
      {audit.pages.length > 0 && (
        <section>
          <h4 className="text-xs font-medium text-muted-foreground">
            {t("audited")}
          </h4>
          <ul className="mt-1 space-y-2">
            {audit.pages.map((row) => (
              <li key={row.url} className="min-w-0">
                <p className="font-mono text-xs leading-5 [overflow-wrap:anywhere]">
                  {page(row.url)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("pickedFor", { reasons: row.pickedFor.join(", ") })}
                  {" · "}
                  {t("findings", { count: row.findingsTotal })}
                </p>
                {row.findings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {row.findings.slice(0, FIRST_FINDINGS).map((finding) => (
                      <li
                        key={finding.title}
                        className="flex items-baseline gap-2"
                      >
                        <span className="min-w-0">{finding.title}</span>
                        {ranked(finding.severity) && (
                          <SeoSeverity severity={finding.severity} />
                        )}
                      </li>
                    ))}
                    {row.findingsTotal > FIRST_FINDINGS && (
                      <li className="text-muted-foreground">
                        {t("moreFindings", {
                          count: row.findingsTotal - FIRST_FINDINGS,
                        })}
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {audit.skipped.length > 0 && (
        <section>
          <h4 className="text-xs font-medium text-muted-foreground">
            {t("skipped")}
          </h4>
          <ul className="mt-1 space-y-1 text-xs">
            {audit.skipped.map((row) => (
              <li key={row.url} className="min-w-0">
                <span className="font-mono [overflow-wrap:anywhere]">
                  {page(row.url)}
                </span>
                <span className="block text-muted-foreground">
                  {sentence(row.reason)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
