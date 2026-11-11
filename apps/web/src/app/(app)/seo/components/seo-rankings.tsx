"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SeoCompetitors } from "./seo-competitors";
import { keywordGroups } from "./seo-keyword-rows-model";
import { SeoKeywords, SeoQueryFilter } from "./seo-keywords";
import {
  SEO_CHOSEN_CLASS,
  type SeoRankingsSection,
  seoSectionClass,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * The Rankings tab. Keywords, ideas and competitors one under the other are
 * three screens of rows, so a switch shows one list at a time.
 */
export function SeoRankings({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const groups = keywordGroups(model.data.keywords);
  const ideas = groups.ideas.length;
  // With ideas and no checked keyword, the Keywords list is empty: the tab opens on the ideas.
  const [chosen, setSection] = useState<SeoRankingsSection>(() =>
    ideas && !groups.checked.length ? "ideas" : "keywords",
  );
  const sections: { id: SeoRankingsSection; label: string }[] = [
    { id: "keywords", label: t("keywords.title") },
    ...(ideas
      ? [{ id: "ideas" as const, label: t("keywords.ideas.short") }]
      : []),
    { id: "competitors", label: t("competitors.title") },
  ];
  // The last idea can leave the list while it shows: then the keywords show, not an empty tab.
  const section = sections.some(({ id }) => id === chosen)
    ? chosen
    : "keywords";
  return (
    <div className="space-y-6">
      {/* The switch and the filter of its list share one line; on a phone the filter is the line under it. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <fieldset className="flex gap-1 max-sm:w-full">
          <legend className="sr-only">{t("tabs.rankings")}</legend>
          {sections.map(({ id, label }) => (
            <Button
              key={id}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={section === id}
              className={cn(
                "min-h-10 min-w-0 flex-1 sm:flex-none sm:px-4",
                section === id && SEO_CHOSEN_CLASS,
              )}
              onClick={() => setSection(id)}
            >
              {label}
            </Button>
          ))}
        </fieldset>
        {/* One filter for keywords and ideas: the lists show a keyword once, so it counts keywords, not device rows. */}
        <div
          className={cn(
            "w-full empty:hidden sm:ms-auto sm:w-72",
            seoSectionClass(section !== "competitors"),
          )}
        >
          <SeoQueryFilter
            model={model}
            // The list in view decides: 16 keywords need no filter box, 71 ideas do.
            rows={
              section === "ideas" ? groups.ideas.length : groups.checked.length
            }
          />
        </div>
      </div>
      <SeoKeywords model={model} section={section} />
      <div className={seoSectionClass(section === "competitors")}>
        <SeoCompetitors model={model} />
      </div>
    </div>
  );
}
