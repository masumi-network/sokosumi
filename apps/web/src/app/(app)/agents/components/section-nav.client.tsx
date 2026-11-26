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

/** How long a jump into a loading section waits to hand focus on. */
const FOCUS_HANDOFF_MS = 10_000;

/**
 * A jump into a section that is still loading focuses its fallback heading,
 * which Suspense then swaps for the real one with the same id. Moves focus
 * to the replacement, but only while focus is lost with the removed node:
 * a reader who has moved on keeps their focus.
 */
function handOffFocus(fallback: HTMLElement) {
  if (!fallback.closest("[data-agents-section-loading]")) return;
  const { id } = fallback;
  const observer = new MutationObserver(() => {
    if (fallback.isConnected) return;
    const replacement = document.getElementById(id);
    if (!replacement) return;
    stop();
    const active = document.activeElement;
    if (!active || active === document.body) {
      replacement.focus({ preventScroll: true });
    }
  });
  const timer = window.setTimeout(stop, FOCUS_HANDOFF_MS);
  function stop() {
    observer.disconnect();
    window.clearTimeout(timer);
  }
  observer.observe(document.body, { childList: true, subtree: true });
}

/** The section headings' ids, in page order. */
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
    const heading = document.getElementById(id);
    if (!heading) return;
    heading.scrollIntoView({
      block: "start",
      behavior: matchesMediaQuery(REDUCED_MOTION_MEDIA_QUERY)
        ? "auto"
        : "smooth",
    });
    heading.focus({ preventScroll: true });
    handOffFocus(heading);
    writeAgentsSectionHash(id, AGENTS_SECTION_IDS[0]);
  }

  return (
    <nav
      ref={setNav}
      aria-label={t("sectionNavLabel")}
      className="bg-background sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 -mx-4 -my-4 px-4 py-2 md:hidden"
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
