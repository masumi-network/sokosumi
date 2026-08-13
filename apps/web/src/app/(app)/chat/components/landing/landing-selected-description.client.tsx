"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { clampLandingDescription } from "./landing-content";

interface LandingSelectedDescriptionProps {
  /** Remount key — selection id so more/less resets when the user taps another face. */
  coworkerId: string;
  /** Empty string still mounts the reserved collapsed slot. */
  description: string;
  size?: "compact" | "default";
}

/**
 * Clamped description sits *above* Start chat. Collapsed state always reserves
 * ~3 lines (`min-h-[3lh]`) plus a toggle-row slot so empty / short / long
 * previews cannot move the CTA. Expanding More grows downward and may shift
 * Start chat; Less restores the reserved height.
 */
export function LandingSelectedDescription({
  coworkerId,
  description,
  size = "default",
}: LandingSelectedDescriptionProps) {
  return (
    <LandingSelectedDescriptionBody
      key={coworkerId}
      description={description}
      size={size}
    />
  );
}

function LandingSelectedDescriptionBody({
  description,
  size = "default",
}: Omit<LandingSelectedDescriptionProps, "coworkerId">) {
  const t = useTranslations("App.Chat.Landing");
  const [expanded, setExpanded] = useState(false);
  const trimmed = description.trim();
  const { isTruncated, preview } = clampLandingDescription(trimmed);
  const text = !trimmed
    ? "\u00a0"
    : expanded || !isTruncated
      ? trimmed
      : preview;

  return (
    <div
      className={cn(
        "text-muted-foreground w-full min-w-0 text-balance",
        size === "compact"
          ? "mt-3 text-[0.8125rem] leading-[1.5]"
          : "mt-4 text-[0.9375rem] leading-[1.55]",
      )}
      data-testid="landing-selected-description"
    >
      <p
        className={cn(
          // `3lh` follows the element's line-height (twMerge drops `leading-*`
          // next to `line-clamp-*`). Collapsed reserve is always three lines.
          !expanded && "line-clamp-3 min-h-[3lh]",
        )}
        data-testid="landing-selected-description-text"
      >
        {text}
      </p>
      {/* Toggle row stays reserved when collapsed so coworkers without a More
          control (short / empty) match truncated ones for CTA position. */}
      <div
        className={cn(
          "mt-1 flex min-h-[1.25rem] items-start justify-center",
          expanded && isTruncated && "min-h-0",
        )}
        data-testid="landing-description-toggle-slot"
      >
        {isTruncated ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="text-foreground h-auto px-0 text-xs font-medium"
            aria-expanded={expanded}
            data-testid="landing-description-toggle"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? t("team.showLess") : t("team.showMore")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
