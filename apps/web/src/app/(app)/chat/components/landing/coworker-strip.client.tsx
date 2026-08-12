"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useOpenCoworkerRoom } from "./use-open-coworker-room";

export interface StripCoworker {
  id: string;
  imageUrl: null | string;
  name: string;
  /** The coworker's speciality, shown in the tooltip. Null when unset. */
  title: null | string;
}

interface CoworkerStripProps {
  featured: StripCoworker;
  /** Rendered around the featured coworker, split evenly left and right. */
  others: StripCoworker[];
  /** `compact` fits the row inside a 390px viewport. */
  size?: "compact" | "default";
}

const STRIP_SIZES = {
  compact: {
    featured: "size-20",
    other: "size-11",
    gap: "gap-3",
    featuredSizes: "80px",
    otherSizes: "44px",
    featuredInitial: "text-xl",
    otherInitial: "text-xs",
  },
  default: {
    featured: "size-28",
    other: "size-16",
    gap: "gap-5 sm:gap-8",
    featuredSizes: "112px",
    otherSizes: "64px",
    featuredInitial: "text-2xl",
    otherInitial: "text-sm",
  },
} as const;

/**
 * The featured coworker flanked by the rest of the team.
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

  // Callers pass an even list, so the flanks match and the featured face lands
  // on the optical centre.
  const half = Math.floor(others.length / 2);
  const left = others.slice(0, half);
  const right = others.slice(half);

  function renderCoworker(coworker: StripCoworker, isFeatured: boolean) {
    return (
      <Tooltip key={coworker.id}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("cta.button", { name: coworker.name })}
            className={cn(
              // Ring on every face, not just the featured one: several
              // coworker portraits are dark-on-dark and vanish into the page
              // in dark mode without an edge to hold them.
              "focus-visible:ring-ring ring-border bg-muted relative shrink-0 cursor-pointer overflow-hidden rounded-full ring-1 transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              isFeatured
                ? scale.featured
                : cn("opacity-70 hover:opacity-100", scale.other),
              openingId === coworker.id && "opacity-50",
            )}
            disabled={isPending}
            onClick={() => openCoworkerRoom(coworker.id)}
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
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span className="font-medium">{coworker.name}</span>
          {/* The featured coworker's title is already spelled out under the
              strip, so repeating it here would only contradict it. */}
          {!isFeatured && coworker.title ? (
            <span className="block opacity-80">{coworker.title}</span>
          ) : null}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className={cn("flex w-full items-center justify-center", scale.gap)}>
      {left.map((coworker) => renderCoworker(coworker, false))}
      {renderCoworker(featured, true)}
      {right.map((coworker) => renderCoworker(coworker, false))}
    </div>
  );
}
