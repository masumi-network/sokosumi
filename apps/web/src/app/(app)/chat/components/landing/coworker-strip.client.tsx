"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffectEvent, useRef } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";

import { findNearestCenterIdFromElements } from "./nearest-center-coworker";
import { resolveOverflowStripGapPx } from "./peek-safe-strip-gap";

export interface StripCoworker {
  id: string;
  imageUrl: null | string;
  name: string;
  /** Specialty shown under the name. Null when unset. */
  title: null | string;
}

interface CoworkerStripProps {
  coworkers: StripCoworker[];
  /** Currently selected coworker — larger face, Start chat target. */
  selectedId: string;
  /**
   * Coworker to optically centre on first paint (Elena / fallback).
   */
  centerOnId: string;
  onSelect: (coworkerId: string) => void;
  /** `compact` fits the row inside a 390px viewport. */
  size?: "compact" | "default";
}

const STRIP_SIZES = {
  compact: {
    featured: "size-20",
    other: "size-11",
    // Preferred 1rem; overflow may override via --strip-gap (peek-safe).
    gap: "gap-[length:var(--strip-gap,1rem)]",
    preferredGapRem: 1,
    // All chips share the featured width so selection reflow cannot move
    // centers while scroll-driven selection is active.
    itemWidth: "w-[5.5rem]",
    featuredSizes: "80px",
    otherSizes: "44px",
    featuredInitial: "text-xl",
    otherInitial: "text-xs",
    name: "text-xs",
    title: "text-[0.625rem]",
    // Half featured width: lets first/last faces reach optical center.
    edgePad: "px-[max(0.25rem,calc(50%-2.75rem))]",
  },
  default: {
    featured: "size-28",
    other: "size-16",
    gap: "gap-[length:var(--strip-gap,1.25rem)]",
    preferredGapRem: 1.25,
    itemWidth: "w-28",
    featuredSizes: "112px",
    otherSizes: "64px",
    featuredInitial: "text-2xl",
    otherInitial: "text-sm",
    name: "text-sm",
    title: "text-xs",
    edgePad: "px-[max(0.25rem,calc(50%-3.5rem))]",
  },
} as const;

/**
 * Horizontal scrollable strip for browsing coworkers on the landing.
 *
 * The scrollport is always column-bounded (`w-full min-w-0`) and expects a
 * full-bleed parent (no page `px-*` on overflow ancestors) so edge faces are
 * not inset-and-clipped. The `w-max` track lives *inside* overflow-x-auto so
 * it cannot widen the picker or page. On mount, scrolls so `centerOnId` sits
 * optically in the middle. While the user scrolls, selection follows the
 * coworker nearest the visual center; tap selects and centers that face.
 * When the track overflows, `--strip-gap` is tuned so a middle-centered chip
 * shows a strong peek at both scrollport edges (mid-chip band, not a 4px
 * sliver/haircut; overflow-only; fit case keeps preferred).
 * Strip titles always reserve two lines (`min-h-[2lh]`) so 1-line vs wrapping
 * captions cannot change row height and push Start chat.
 */
export function CoworkerStrip({
  coworkers,
  selectedId,
  centerOnId,
  onSelect,
  size = "default",
}: CoworkerStripProps) {
  const t = useTranslations("App.Chat.Landing");
  const scale = STRIP_SIZES[size];
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  /** >0 while programmatic scrollIntoView should not drive selection. */
  const suppressScrollSelectRef = useRef(0);

  function runProgrammaticCenter(
    child: HTMLElement,
    behavior: ScrollBehavior,
  ): void {
    const scroll = scrollRef.current;
    suppressScrollSelectRef.current += 1;
    let released = false;

    function release(): void {
      if (released) {
        return;
      }
      released = true;
      suppressScrollSelectRef.current = Math.max(
        0,
        suppressScrollSelectRef.current - 1,
      );
      scroll?.removeEventListener("scrollend", release);
    }

    try {
      child.scrollIntoView({
        behavior,
        block: "nearest",
        inline: "center",
      });
    } catch {
      // jsdom / older engines may lack scrollIntoView — still release suppress.
      release();
      return;
    }

    if (behavior === "smooth" && scroll) {
      scroll.addEventListener("scrollend", release, { once: true });
      window.setTimeout(release, 500);
      return;
    }

    // `auto` centering is synchronous; any scroll events from it already ran
    // while suppress was elevated.
    release();
  }

  const syncSelectionFromScroll = useEffectEvent(() => {
    if (suppressScrollSelectRef.current > 0) {
      return;
    }

    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }

    const nearestId = findNearestCenterIdFromElements(
      scroll,
      itemRefs.current.entries(),
    );
    if (nearestId && nearestId !== selectedId) {
      onSelect(nearestId);
    }
  });

  const syncPeekSafeGap = useEffectEvent(() => {
    const scroll = scrollRef.current;
    const track = trackRef.current;
    if (!scroll || !track) {
      return;
    }

    if (scroll.scrollWidth <= scroll.clientWidth) {
      track.style.removeProperty("--strip-gap");
      return;
    }

    const firstChip = track.querySelector<HTMLElement>("[data-coworker-id]");
    if (!firstChip) {
      return;
    }

    const itemWidthPx = firstChip.getBoundingClientRect().width;
    const rootFontPx = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    const preferredGapPx = scale.preferredGapRem * rootFontPx;
    if (
      !(itemWidthPx > 0) ||
      !(preferredGapPx > 0) ||
      !(scroll.clientWidth > 0)
    ) {
      return;
    }

    const gapPx = resolveOverflowStripGapPx({
      viewportWidthPx: scroll.clientWidth,
      itemWidthPx,
      preferredGapPx,
    });

    if (Math.abs(gapPx - preferredGapPx) < 0.5) {
      track.style.removeProperty("--strip-gap");
      return;
    }

    track.style.setProperty("--strip-gap", `${gapPx}px`);
  });

  useMountEffect(() => {
    const child = itemRefs.current.get(centerOnId);
    if (!child) {
      return;
    }

    // Double rAF: wait until flex widths settle so centre isn't measured at 0.
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        runProgrammaticCenter(child, "auto");
      });
    });

    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  });

  useMountEffect(() => {
    const scroll = scrollRef.current;
    const track = trackRef.current;
    if (!scroll || typeof ResizeObserver === "undefined") {
      return;
    }

    syncPeekSafeGap();
    const observer = new ResizeObserver(() => {
      syncPeekSafeGap();
    });
    observer.observe(scroll);
    if (track) {
      observer.observe(track);
    }

    return () => {
      observer.disconnect();
    };
  });

  function handleSelect(coworkerId: string): void {
    onSelect(coworkerId);
    const child = itemRefs.current.get(coworkerId);
    if (!child) {
      return;
    }
    runProgrammaticCenter(child, "smooth");
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        // min-w-0 is load-bearing: without it, a flex ancestor sizes to the
        // w-max track and the Start chat `w-full` stretches to ~900px.
        "w-full min-w-0 max-w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      data-testid="coworker-strip-scroll"
      role="listbox"
      aria-label={t("team.stripLabel")}
      onScroll={syncSelectionFromScroll}
    >
      <div
        ref={trackRef}
        className={cn(
          // min-w-full + justify-center: when the catalog fits, Elena (middle
          // of the track) lands in the visual centre. When it overflows, w-max
          // wins and edgePad lets first/last faces reach optical center.
          // Gap uses --strip-gap when overflowing so middle-centered chips
          // peek-cut both scrollport edges (see syncPeekSafeGap).
          "flex w-max min-w-full items-start justify-center py-1",
          scale.edgePad,
          scale.gap,
        )}
        data-testid="coworker-strip-track"
      >
        {coworkers.map((coworker) => {
          const isSelected = coworker.id === selectedId;

          return (
            <button
              key={coworker.id}
              ref={(node) => {
                if (node) {
                  itemRefs.current.set(coworker.id, node);
                } else {
                  itemRefs.current.delete(coworker.id);
                }
              }}
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-label={t("team.select", { name: coworker.name })}
              data-coworker-id={coworker.id}
              className={cn(
                "flex shrink-0 cursor-pointer flex-col items-center gap-2 text-center transition-opacity outline-none",
                "focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:ring-offset-2",
                scale.itemWidth,
              )}
              onClick={() => handleSelect(coworker.id)}
            >
              <span
                className={cn(
                  // Ring on every face: several coworker portraits are
                  // dark-on-dark and vanish into the page in dark mode without
                  // an edge to hold them.
                  "ring-border bg-muted relative shrink-0 overflow-hidden rounded-full ring-1",
                  isSelected
                    ? scale.featured
                    : cn("opacity-70 hover:opacity-100", scale.other),
                )}
              >
                {coworker.imageUrl ? (
                  <Image
                    alt={t("team.avatarAlt", { name: coworker.name })}
                    className="object-cover object-top"
                    fill
                    priority={isSelected}
                    sizes={isSelected ? scale.featuredSizes : scale.otherSizes}
                    src={coworker.imageUrl}
                  />
                ) : (
                  <span
                    className={cn(
                      "text-muted-foreground flex size-full items-center justify-center font-medium",
                      isSelected ? scale.featuredInitial : scale.otherInitial,
                    )}
                  >
                    {coworker.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn(
                    "text-foreground truncate font-medium leading-tight",
                    scale.name,
                  )}
                >
                  {coworker.name}
                </span>
                {/* Always reserve two title lines so 1-line / empty / wrapping
                    captions cannot grow or shrink the strip row (and Start chat).
                    `2lh` follows the element's line-height (twMerge drops
                    `leading-*` next to `line-clamp-*`). */}
                <span
                  className={cn(
                    "text-muted-foreground line-clamp-2 min-h-[2lh]",
                    scale.title,
                  )}
                  data-testid="coworker-strip-title"
                >
                  {coworker.title ?? "\u00a0"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
