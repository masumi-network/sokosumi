"use client";

import { cn } from "@/lib/utils";

interface LandingSelectedDescriptionProps {
  /** Remount key — selection id so copy resets when the user taps another face. */
  coworkerId: string;
  /** Empty string still mounts the reserved one-sentence slot. */
  description: string;
  size?: "compact" | "default";
}

/**
 * One-sentence pitch sits *above* Start chat. Always reserves two lines
 * (`min-h-[2lh]`) so empty / short / wrapping copy cannot move the CTA.
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
  const trimmed = description.trim();
  const text = trimmed || "\u00a0";

  return (
    <div
      className={cn(
        "text-muted-foreground w-full min-w-0 text-balance",
        size === "compact"
          ? "text-[0.8125rem] leading-[1.5]"
          : "text-[0.9375rem] leading-[1.55]",
      )}
      data-testid="landing-selected-description"
    >
      <p
        className="line-clamp-2 min-h-[2lh]"
        data-testid="landing-selected-description-text"
      >
        {text}
      </p>
    </div>
  );
}
