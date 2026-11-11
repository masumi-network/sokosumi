"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SeoCompetitors } from "./seo-competitors";
import { keywordGroups } from "./seo-keyword-rows-model";
import { SeoKeywords } from "./seo-keywords";
import {
  SEO_CHOSEN_CLASS,
  type SeoRankingsSection,
  seoPhoneSectionClass,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * The Rankings tab. A wide screen shows keywords, ideas and competitors one
 * under the other. On a phone the three lists are one long page of cards, so a
 * switch shows one list at a time.
 */
export function SeoRankings({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const [chosen, setSection] = useState<SeoRankingsSection>("keywords");
  const ideas = keywordGroups(model.data.keywords).ideas.length;
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
      <fieldset className="flex gap-1 sm:hidden">
        <legend className="sr-only">{t("tabs.rankings")}</legend>
        {sections.map(({ id, label }) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={section === id}
            className={cn(
              "min-h-10 min-w-0 flex-1",
              section === id && SEO_CHOSEN_CLASS,
            )}
            onClick={() => setSection(id)}
          >
            {label}
          </Button>
        ))}
      </fieldset>
      <SeoKeywords model={model} phoneSection={section} />
      <div className={seoPhoneSectionClass(section === "competitors")}>
        <SeoCompetitors model={model} />
      </div>
    </div>
  );
}
