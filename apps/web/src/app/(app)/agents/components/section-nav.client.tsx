"use client";

import { useTranslations } from "next-intl";
import { type MouseEvent, useState } from "react";

import {
  SEGMENTED_CONTROL_CLASS_NAME,
  SEGMENTED_CONTROL_ITEM_CLASS_NAME,
} from "@/components/ui/segmented-control-classes";
import {
  useAgentsSectionNav,
  writeAgentsSectionHash,
} from "@/hooks/effects/use-agents-section-nav";
import {
  matchesMediaQuery,
  REDUCED_MOTION_MEDIA_QUERY,
} from "@/hooks/effects/use-media-query";
import { cn } from "@/lib/utils";

/** The ids of the sections' stable wrappers (`SectionTarget`), in page order. */
const AGENTS_SECTION_IDS = [
  "agents-soko-bots",
  "agents-coworkers",
  "agents-marketplace",
] as const;

/**
 * Phones only: the Agents page is one long scroll, so a bar under the top
 * bar jumps to Soko Bots, Coworkers or the Marketplace and marks where the
 * reader is. Desktop shows all three at once and keeps no bar.
 */
export function AgentsSectionNav() {
  const t = useTranslations("App.Agents.Directory");
  const [nav, setNav] = useState<HTMLElement | null>(null);
  const current = useAgentsSectionNav(nav, AGENTS_SECTION_IDS);
  const labels = {
    "agents-soko-bots": t("sokoBotsTitle"),
    "agents-coworkers": t("coworkersTitle"),
    "agents-marketplace": t("marketplaceShort"),
  };

  function jump(event: MouseEvent<HTMLAnchorElement>, id: string) {
    // A native hash jump would push a history entry Next.js cannot restore.
    event.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({
      block: "start",
      behavior: matchesMediaQuery(REDUCED_MOTION_MEDIA_QUERY)
        ? "auto"
        : "smooth",
    });
    // The wrapper outlives the section's fallback, so focus stays on it.
    target.focus({ preventScroll: true });
    writeAgentsSectionHash(id, AGENTS_SECTION_IDS[0]);
  }

  // Sticky `top` counts from `main`'s content box, which starts below its
  // `pt-[calc(5rem+env(safe-area-inset-top))]`; -1rem puts the bar right
  // under the 4rem fixed top bar.
  return (
    <nav
      ref={setNav}
      aria-label={t("sectionNavLabel")}
      className="bg-background sticky -top-4 z-10 -mx-4 -my-4 px-4 py-2 md:hidden"
    >
      <div className={cn(SEGMENTED_CONTROL_CLASS_NAME, "flex w-full")}>
        {AGENTS_SECTION_IDS.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={current === id ? "location" : undefined}
            data-state={current === id ? "on" : "off"}
            onClick={(event) => jump(event, id)}
            className={cn(SEGMENTED_CONTROL_ITEM_CLASS_NAME, "h-9 px-2")}
          >
            <span className="truncate">{labels[id]}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
