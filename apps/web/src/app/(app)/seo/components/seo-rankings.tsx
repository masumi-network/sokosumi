"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  SEGMENTED_CONTROL_CLASS_NAME,
  SEGMENTED_CONTROL_ITEM_CLASS_NAME,
} from "@/components/ui/segmented-control-classes";
import { cn } from "@/lib/utils";
import { SeoCompetitors } from "./seo-competitors";
import { SeoKeywordMap } from "./seo-keyword-map";
import { keywordGroups } from "./seo-keyword-rows-model";
import { SeoKeywords, SeoQueryFilter } from "./seo-keywords";
import { SeoShareOfVoice } from "./seo-share-of-voice";
import { type SeoRankingsSection, seoSectionClass } from "./seo-shared";
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
    <div className="stagger space-y-6">
      {/* The switch and the filter of its list share one line; on a phone the filter is the line under it. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* One control with three parts: three framed buttons read as three things. The look is the app's
            segmented control; the parts stay buttons with a pressed state, so a hidden list is not a hidden panel. */}
        <fieldset
          className={cn(
            SEGMENTED_CONTROL_CLASS_NAME,
            "max-sm:flex max-sm:w-full",
          )}
        >
          <legend className="sr-only">{t("tabs.rankings")}</legend>
          {sections.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={section === id}
              data-state={section === id ? "on" : "off"}
              // 40 px for a finger on a phone, as the other controls of the tab.
              className={cn(
                SEGMENTED_CONTROL_ITEM_CLASS_NAME,
                "max-sm:h-10 sm:flex-none sm:px-4",
              )}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
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
      {/* Over the list, the map of the list in view: which keywords are worth the work, at one look (owner,
          after pass 59). The competitors list has no use for the map. */}
      {section === "competitors" ? null : (
        <SeoKeywordMap
          groups={
            section === "ideas"
              ? { checked: [], ideas: groups.ideas }
              : { checked: groups.checked, ideas: [] }
          }
        />
      )}
      {/* The site against its confirmed competitors over the tracked keywords: no use on the list of ideas. */}
      {section === "ideas" ? null : (
        <SeoShareOfVoice shareOfVoice={model.data.shareOfVoice} />
      )}
      <SeoKeywords model={model} section={section} />
      <div className={seoSectionClass(section === "competitors")}>
        <SeoCompetitors model={model} />
      </div>
    </div>
  );
}
