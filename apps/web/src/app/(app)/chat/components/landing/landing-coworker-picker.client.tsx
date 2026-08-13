"use client";

import { useState } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import { cn } from "@/lib/utils";

import { CoworkerStrip } from "./coworker-strip.client";
import {
  orderStripCoworkers,
  selectedCoworkerCaption,
  selectedCoworkerDescription,
} from "./landing-content";
import { LandingSelectedDescription } from "./landing-selected-description.client";
import { StartChatButton } from "./start-chat-button.client";

interface LandingCoworkerPickerProps {
  coworkers: Coworker[];
  /** Elena (or fallback) — default selection before the user taps. */
  initialSelectedId: string;
  size?: "compact" | "default";
  /** Mobile passes `w-full` so the CTA spans the column. */
  startChatClassName?: string;
}

/**
 * Landing strip + details + Start chat.
 *
 * Order under the strip: name → caption → Start chat → description.
 * Description lives below the CTA so length / more-less never moves the button.
 * Default featured (Elena) sits in the middle of the full catalog and is
 * scrolled into optical centre on first paint.
 */
export function LandingCoworkerPicker({
  coworkers,
  initialSelectedId,
  size = "default",
  startChatClassName,
}: LandingCoworkerPickerProps) {
  const [selectedId, setSelectedId] = useState(initialSelectedId);

  const initial =
    coworkers.find((coworker) => coworker.id === initialSelectedId) ??
    coworkers[0];
  if (!initial) {
    return null;
  }

  const selected =
    coworkers.find((coworker) => coworker.id === selectedId) ?? initial;

  const stripCoworkers = orderStripCoworkers(coworkers, initial);
  const selectedCaption = selectedCoworkerCaption(selected);
  const selectedDescription = selectedCoworkerDescription(selected);

  return (
    <div data-testid="landing-coworker-picker">
      <div className={cn(size === "compact" ? "mt-8" : "mt-12", "w-full")}>
        <CoworkerStrip
          centerOnId={initial.id}
          coworkers={stripCoworkers}
          onSelect={setSelectedId}
          selectedId={selected.id}
          size={size}
        />
      </div>

      <p
        className={cn(
          "font-semibold tracking-[-0.01em]",
          size === "compact" ? "mt-4 text-lg" : "mt-5 text-xl",
        )}
        data-testid="landing-selected-name"
      >
        {selected.name}
      </p>
      {selectedCaption ? (
        <p
          className={cn(
            "text-muted-foreground",
            size === "compact"
              ? "mt-1 text-[0.8125rem] leading-snug"
              : "mt-1.5 text-sm leading-snug",
          )}
          data-testid="landing-selected-caption"
        >
          {selectedCaption}
        </p>
      ) : null}

      <div
        className={cn("mt-6", size === "compact" && "w-full max-w-xs")}
        data-testid="landing-start-chat"
      >
        <StartChatButton
          className={startChatClassName}
          coworkerId={selected.id}
          coworkerName={selected.name}
        />
      </div>

      {selectedDescription ? (
        <LandingSelectedDescription
          coworkerId={selected.id}
          description={selectedDescription}
          size={size}
        />
      ) : null}
    </div>
  );
}
