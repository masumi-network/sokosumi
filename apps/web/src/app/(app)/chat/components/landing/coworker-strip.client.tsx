"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import { useOpenCoworkerRoom } from "./use-open-coworker-room";

export interface StripCoworker {
  id: string;
  imageUrl: null | string;
  name: string;
  /** Specialty shown under the name. Null when unset. */
  title: null | string;
}

interface CoworkerStripProps {
  featured: StripCoworker;
  /** Remaining teammates, rendered after the featured coworker. */
  others: StripCoworker[];
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
 * Horizontal scrollable strip: featured coworker first, then the rest.
 *
 * Every face opens that coworker's direct room, so the strip doubles as a
 * picker — the point being that Elena is a starting suggestion, not the only
 * coworker available.
 */
export function CoworkerStrip({
  featured,
  others,
  size = "default",
}: CoworkerStripProps) {
  const t = useTranslations("App.Chat.Landing");
  const { isPending, openCoworkerRoom, openingId } = useOpenCoworkerRoom();
  const scale = STRIP_SIZES[size];
  const strip = [featured, ...others];

  return (
    <div
      className={cn(
        "w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      data-testid="coworker-strip-scroll"
    >
      <div
        className={cn(
          "flex w-max min-w-full items-start justify-center px-1 py-1",
          scale.gap,
        )}
      >
        {strip.map((coworker) => {
          const isFeatured = coworker.id === featured.id;

          return (
            <button
              key={coworker.id}
              type="button"
              aria-label={t("cta.button", { name: coworker.name })}
              className={cn(
                "flex shrink-0 cursor-pointer flex-col items-center gap-2 text-center transition-opacity outline-none",
                "focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:ring-offset-2",
                isFeatured ? scale.featuredItemWidth : scale.itemWidth,
                openingId === coworker.id && "opacity-50",
              )}
              disabled={isPending}
              onClick={() => openCoworkerRoom(coworker.id)}
            >
              <span
                className={cn(
                  // Ring on every face: several coworker portraits are
                  // dark-on-dark and vanish into the page in dark mode without
                  // an edge to hold them.
                  "ring-border bg-muted relative shrink-0 overflow-hidden rounded-full ring-1",
                  isFeatured
                    ? scale.featured
                    : cn("opacity-70 hover:opacity-100", scale.other),
                )}
              >
                {coworker.imageUrl ? (
                  <Image
                    alt={t("team.avatarAlt", { name: coworker.name })}
                    className="object-cover object-top"
                    fill
                    priority={isFeatured}
                    sizes={isFeatured ? scale.featuredSizes : scale.otherSizes}
                    src={coworker.imageUrl}
                  />
                ) : (
                  <span
                    className={cn(
                      "text-muted-foreground flex size-full items-center justify-center font-medium",
                      isFeatured ? scale.featuredInitial : scale.otherInitial,
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
