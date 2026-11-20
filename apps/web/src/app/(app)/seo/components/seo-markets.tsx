"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { SEO_BREAKDOWN_SHOWN } from "./seo-breakdown";
import { SeoDate, SeoPeriod } from "./seo-date";
import { seoMarketEvidence } from "./seo-markets-model";
import { SEO_STACKED_TABLE_CLASS, SeoFoldSummary } from "./seo-shared";

const regions = new Intl.DisplayNames(["en"], { type: "region" });
const languages = new Intl.DisplayNames(["en"], { type: "language" });
const countryName = (code: string) =>
  /^[A-Z]{2}$/.test(code) ? (regions.of(code) ?? code) : code;
const marketName = (country: string, language: string) =>
  [
    countryName(country),
    /^[a-z]{2,3}$/i.test(language)
      ? (languages.of(language) ?? language)
      : language,
  ].join(" · ");

export function SeoMarkets({
  data,
  pageId,
}: {
  data: ProjectSeoWorkspace;
  pageId?: string | null;
}) {
  const t = useSeoResultTranslations("App.Seo.markets");
  const format = useSeoResultFormatter();
  const { site, page, pageUrl, evidence, foreign } = seoMarketEvidence(
    data,
    pageId,
  );
  const comparison = site?.markets;
  const note = site?.marketNote;
  const countries = evidence?.countries;
  if (!page && !site && !countries) return null;
  const percent = (value: number) =>
    format.number(value, { style: "percent", maximumFractionDigits: 1 });
  const columns = [
    "market",
    "siteShare",
    "rivalShare",
    "products",
    "monthlyVisits",
  ] as const;
  const table = (
    rows: NonNullable<typeof comparison>["rows"],
    caption: string,
  ) => (
    <Table className={SEO_STACKED_TABLE_CLASS}>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          {columns.map((key) => (
            <TableHead key={key} scope="col">
              {t(key)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.country + "-" + row.language}>
            <TableCell data-label={t("market")}>
              <strong>{marketName(row.country, row.language)}</strong>
              {row.start && <> · {t("baseline")}</>}
              {row.regionVersion && (
                <small className="block">
                  {t("regionalVersion", { tag: row.regionVersion })}
                </small>
              )}
            </TableCell>
            <TableCell data-label={t("siteShare")}>
              {row.ownShare === null ? t("unknown") : percent(row.ownShare)}
            </TableCell>
            <TableCell data-label={t("rivalShare")}>
              {percent(row.share)}
            </TableCell>
            <TableCell data-label={t("products")}>
              {t("rivalCount", { count: row.rivals, total: row.of })}
            </TableCell>
            <TableCell data-label={t("monthlyVisits")}>
              {format.number(row.etv)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
  const exposureLine = (row: (typeof foreign)[number]) => (
    <li key={row.key}>
      {countryName(row.key)} ·{" "}
      {t("exposure", { clicks: row.clicks, impressions: row.impressions })}
    </li>
  );
  const candidates = comparison?.rows.filter((row) => row.candidate) ?? [];
  const others = comparison?.rows.filter((row) => !row.candidate) ?? [];
  return (
    <section
      lang="en"
      aria-label={t("title")}
      className="min-w-0 space-y-3 border-t pt-4 text-sm"
    >
      <h3 className="font-semibold">{t("title")}</h3>
      {comparison ? (
        <>
          <p>
            {t("basis")} ·{" "}
            <SeoDate day report value={site?.observedAt ?? null} />
          </p>
          {candidates.length ? (
            <>
              {table(candidates, t("title"))}
              <p>
                {t("next", {
                  markets: candidates
                    .map((row) => marketName(row.country, row.language))
                    .join(", "),
                })}
              </p>
            </>
          ) : (
            <p>
              {t(
                comparison.outside === null
                  ? "noRivals"
                  : !comparison.siteVisits
                    ? "noSite"
                    : "noCandidates",
              )}
            </p>
          )}
          {others.length > 0 && (
            <details>
              <SeoFoldSummary>
                {t("other", { count: others.length })}
              </SeoFoldSummary>
              {table(others, t("other", { count: others.length }))}
            </details>
          )}
          {comparison.outside !== null && (
            <p>{t("outside", { share: percent(comparison.outside) })}</p>
          )}
          <details>
            <SeoFoldSummary>{t("sources")}</SeoFoldSummary>
            <ul>
              {comparison.hosts.map((host) => (
                <li key={host.host}>
                  {host.host} · {t(host.role)} ·{" "}
                  {host.unavailable || host.etv === null
                    ? t("unknown")
                    : format.number(host.etv, {
                        maximumFractionDigits: 1,
                      })}{" "}
                  · <SeoDate report day value={host.fetchedAt} />
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : note ? (
        <p>
          {t(`note.${note}`)} · <SeoDate day report value={site.observedAt} />
        </p>
      ) : (
        <p>{t("missing")}</p>
      )}
      {page && (
        <>
          <p>
            {t("pageBasis")} · <SeoDate report day value={page.observedAt} />
          </p>
          {pageUrl && <p className="break-all">{pageUrl}</p>}
          {page.pageMarketEvidence?.regionalVersions.length ? (
            <ul>
              {page.pageMarketEvidence.regionalVersions.map((v) => (
                <li key={[v.language, v.country, v.url].join("|")}>
                  <span>{marketName(v.country, v.language)}</span> ·{" "}
                  <span className="break-all">{v.url}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("noVersions")}</p>
          )}
        </>
      )}
      {countries && evidence && (
        <div className="space-y-1">
          <h4 className="font-medium">{t("observed")}</h4>
          <p>
            <SeoPeriod
              report
              from={new Date(evidence.from).toISOString().slice(0, 10)}
              to={new Date(evidence.to).toISOString().slice(0, 10)}
            />{" "}
            · {t("selectedPages")}
          </p>
          <details>
            <SeoFoldSummary>{t("measuredPages")}</SeoFoldSummary>
            <ul>
              {evidence.pageUrls.map((url) => (
                <li key={url} className="break-all">
                  {url}
                </li>
              ))}
            </ul>
          </details>
          {evidence.coverage === "partial" && <p>{t("partial")}</p>}
          {foreign.length ? (
            <>
              <ul>{foreign.slice(0, SEO_BREAKDOWN_SHOWN).map(exposureLine)}</ul>
              {foreign.length > SEO_BREAKDOWN_SHOWN && (
                <details>
                  <SeoFoldSummary>
                    {t("moreCountries", {
                      count: foreign.length - SEO_BREAKDOWN_SHOWN,
                    })}
                  </SeoFoldSummary>
                  <ul>
                    {foreign.slice(SEO_BREAKDOWN_SHOWN).map(exposureLine)}
                  </ul>
                </details>
              )}
              <p>
                {t("countryNext", { country: countryName(foreign[0].key) })}
              </p>
            </>
          ) : (
            <p>{t("noExposure")}</p>
          )}
          {countries.truncated && <p>{t("truncated")}</p>}
        </div>
      )}
    </section>
  );
}
