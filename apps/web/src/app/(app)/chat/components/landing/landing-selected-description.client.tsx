"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { clampLandingDescription } from "./landing-content";

interface LandingSelectedDescriptionProps {
  /** Remount key — selection id so more/less resets when the user taps another face. */
  coworkerId: string;
  description: string;
  size?: "compact" | "default";
}

/**
 * Description sits *below* Start chat so expanding more/less grows downward
 * without moving the CTA. Collapsed to ~3 lines / ~180 characters.
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
  const { isTruncated, preview } = clampLandingDescription(description);
  const text = expanded || !isTruncated ? description : preview;

  return (
    <div
      className={cn(
        "text-muted-foreground text-balance",
        size === "compact"
          ? "mt-4 max-w-[40ch] text-[0.8125rem] leading-[1.5]"
          : "mx-auto mt-5 max-w-[46ch] text-[0.9375rem] leading-[1.55]",
      )}
      data-testid="landing-selected-description"
    >
      <p className={cn(!expanded && isTruncated && "line-clamp-3")}>{text}</p>
      {isTruncated ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="text-foreground mt-1 h-auto px-0 text-xs font-medium"
          aria-expanded={expanded}
          data-testid="landing-description-toggle"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? t("team.showLess") : t("team.showMore")}
        </Button>
      ) : null}
    </div>
  );
}
