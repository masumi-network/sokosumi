"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRef } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";

import { opticalCenterScrollLeft } from "./landing-content";

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
   * Coworker to optically centre on first paint (Elena / fallback). Selection
   * changes do not re-scroll — browsing stays where the user left it.
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
    gap: "gap-4",
    itemWidth: "w-[4.5rem]",
    featuredItemWidth: "w-[5.5rem]",
    featuredSizes: "80px",
    otherSizes: "44px",
    featuredInitial: "text-xl",
    otherInitial: "text-xs",
    name: "text-xs",
    title: "text-[0.625rem]",
  },
  default: {
    featured: "size-28",
    other: "size-16",
    gap: "gap-5",
    itemWidth: "w-24",
    featuredItemWidth: "w-28",
    featuredSizes: "112px",
    otherSizes: "64px",
    featuredInitial: "text-2xl",
    otherInitial: "text-sm",
    name: "text-sm",
    title: "text-xs",
  },
} as const;

/**
 * Horizontal scrollable strip for browsing coworkers on the landing.
 *
 * Tap selects a coworker for the Start chat CTA — it does not open a DM.
 * On mount, scrolls so `centerOnId` sits optically in the middle of the
 * viewport (full catalog stays in the row; nothing is dropped).
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
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  useMountEffect(() => {
    const root = scrollRef.current;
    const child = itemRefs.current.get(centerOnId);
    if (!root || !child) {
      return;
    }
    root.scrollLeft = opticalCenterScrollLeft({
      childOffsetLeft: child.offsetLeft,
      childWidth: child.offsetWidth,
      containerWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
    });
  });

  return (
    <div
      ref={scrollRef}
      className={cn(
        "w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      data-testid="coworker-strip-scroll"
      role="listbox"
      aria-label={t("team.stripLabel")}
    >
      <div
        className={cn(
          "flex w-max min-w-full items-start justify-center px-1 py-1",
          scale.gap,
        )}
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
                isSelected ? scale.featuredItemWidth : scale.itemWidth,
              )}
              onClick={() => onSelect(coworker.id)}
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
                {coworker.title ? (
                  <span
                    className={cn(
                      "text-muted-foreground line-clamp-2 leading-snug",
                      scale.title,
                    )}
                  >
                    {coworker.title}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
