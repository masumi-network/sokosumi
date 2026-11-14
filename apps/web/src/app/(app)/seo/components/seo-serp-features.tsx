"use client";

import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { SeoSerpMarker } from "./seo-serp-features-model";
import { SeoDate } from "./seo-shared";

/** A mark that names the reader's own page: the one that matters in a row of marks. */
const OWN = "text-foreground font-medium";

/**
 * What the search results showed on each paid check of a keyword, newest first: AI Overview, featured snippet,
 * People also ask and other features. A read that was not asked for an AI Overview says so.
 */
export function SeoSerpFeatures({ marks }: { marks: SeoSerpMarker[] }) {
  const t = useTranslations("App.Seo.keywords.serp");
  const tDevice = useTranslations("App.Seo.analysis");
  const format = useFormatter();
  const devices = new Set(marks.map((mark) => mark.device)).size > 1;
  return (
    <section className="min-w-0 space-y-1">
      <h4 className="text-sm font-semibold">{t("title")}</h4>
      <p className="text-muted-foreground text-xs">{t("note")}</p>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground text-left">
            <tr>
              <th scope="col" className="py-1 pe-3 font-normal">
                {t("check")}
              </th>
              <th scope="col" className="py-1 pe-3 font-normal">
                {t("aiOverview")}
              </th>
              <th scope="col" className="py-1 pe-3 font-normal">
                {t("featured")}
              </th>
              <th scope="col" className="py-1 pe-3 font-normal">
                {t("peopleAlsoAsk")}
              </th>
              <th scope="col" className="py-1 font-normal">
                {t("features")}
              </th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            {marks.map((mark) => (
              <tr
                // Two checks can share a time; a check reads each device once.
                key={`${mark.observationId}:${mark.device}`}
                className="border-t align-top"
              >
                <th scope="row" className="py-1 pe-3 text-left font-normal">
                  <SeoDate day value={mark.date} />
                  {devices ? ` · ${tDevice(mark.device)}` : null}
                </th>
                {mark.suspect ? (
                  <td colSpan={4} className="py-1">
                    {t("suspect")}
                  </td>
                ) : (
                  <>
                    <td
                      className={cn(
                        "py-1 pe-3",
                        mark.aiOverview === "cited" && OWN,
                      )}
                    >
                      {t(`ai.${mark.aiOverview}`)}
                    </td>
                    <td
                      className={cn(
                        "py-1 pe-3",
                        mark.featured === "owned" && OWN,
                      )}
                    >
                      {t(`snippet.${mark.featured}`)}
                    </td>
                    <td
                      className={cn(
                        "py-1 pe-3",
                        mark.peopleAlsoAsk === "owned" && OWN,
                      )}
                    >
                      {t(`paa.${mark.peopleAlsoAsk}`)}
                    </td>
                    <td className="py-1">
                      {mark.features.length || mark.otherFeatures
                        ? format.list([
                            ...mark.features.map((type) =>
                              t(`feature.${type}`),
                            ),
                            ...(mark.otherFeatures
                              ? [
                                  t("otherFeatures", {
                                    count: mark.otherFeatures,
                                  }),
                                ]
                              : []),
                          ])
                        : t("noFeatures")}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
