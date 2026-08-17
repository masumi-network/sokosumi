"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffectEvent, useRef } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";

import { findNearestCenterIdFromElements } from "./nearest-center-coworker";

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
   * Coworker to optically centre on first paint (highest priority).
   */
  centerOnId: string;
  onSelect: (coworkerId: string) => void;
  /** `compact` fits the row inside a 390px viewport. */
  size?: "compact" | "default";
  /**
   * Optional trailing action rendered after all coworkers (mobile only).
   * Provide both the action component and its ID for selection tracking.
   */
  trailingAction?: {
    id: string;
    render: (props: {
      isSelected: boolean;
      onSelect: () => void;
      ref: (node: HTMLButtonElement | null) => void;
    }) => React.ReactNode;
  };
}

const STRIP_SIZES = {
  compact: {
    featured: "size-20",
    other: "size-11",
    gap: "gap-4",
    // All chips share the featured width so selection reflow cannot move
    // centers while scroll-driven selection is active.
    itemWidth: "w-[5.5rem]",
    featuredSizes: "80px",
    otherSizes: "44px",
    featuredInitial: "text-xl",
    otherInitial: "text-xs",
    name: "text-xs",
    title: "text-[0.625rem]",
    // Half featured width relative to viewport: lets first/last items reach optical center.
    edgePad: "px-[max(0.25rem,calc(50vw-2.75rem))]",
  },
  default: {
    featured: "size-28 xl:size-32",
    other: "size-16 xl:size-20",
    gap: "gap-5 xl:gap-10 2xl:gap-14",
    itemWidth: "w-28 xl:w-36",
    featuredSizes: "(min-width: 1280px) 128px, 112px",
    otherSizes: "(min-width: 1280px) 80px, 64px",
    featuredInitial: "text-2xl",
    otherInitial: "text-sm",
    name: "text-sm",
    title: "text-xs",
    edgePad:
      "px-[max(0.25rem,calc(50vw-3.5rem))] xl:px-[max(1rem,calc(50vw-4.5rem))]",
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
 * Strip titles always reserve two lines (`min-h-[2lh]`) so 1-line vs wrapping
 * captions cannot change row height and push Start chat.
 */
export function CoworkerStrip({
  coworkers,
  selectedId,
  centerOnId,
  onSelect,
  size = "default",
  trailingAction,
}: CoworkerStripProps) {
  const t = useTranslations("App.Chat.Landing");
  const scale = STRIP_SIZES[size];
  const scrollRef = useRef<HTMLDivElement>(null);
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

    // Keep suppress until scroll settles for both `auto` and `smooth`. A late
    // `scroll` after `scrollIntoView` returns can otherwise overwrite the
    // intended selection (mount featured / tap-to-center).
    if (scroll) {
      scroll.addEventListener("scrollend", release, { once: true });
      window.setTimeout(release, 500);
      return;
    }

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
        className={cn(
          // w-max + half-chip edge pad: first/last can still scroll to optical
          // center. justify-evenly + larger xl gaps spread faces when they fit.
          "flex w-max min-w-full items-start justify-evenly py-1",
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
        {trailingAction
          ? trailingAction.render({
              isSelected: selectedId === trailingAction.id,
              onSelect: () => handleSelect(trailingAction.id),
              ref: (node) => {
                if (node) {
                  itemRefs.current.set(trailingAction.id, node);
                } else {
                  itemRefs.current.delete(trailingAction.id);
                }
              },
            })
          : null}
      </div>
    </div>
  );
}
