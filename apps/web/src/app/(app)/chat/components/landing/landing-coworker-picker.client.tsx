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
 * The picker is viewport-bounded (`w-full min-w-0`) so the strip's w-max track
 * cannot widen Start chat. Caption slot keeps a fixed min-height so omitting
 * or wrapping caption does not jump the CTA. Description stays below the CTA.
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
    <div
      className="w-full min-w-0 max-w-full"
      data-testid="landing-coworker-picker"
    >
      <div
        className={cn(
          "w-full min-w-0 max-w-full",
          size === "compact" ? "mt-6" : "mt-10",
        )}
      >
        <CoworkerStrip
          centerOnId={initial.id}
          coworkers={stripCoworkers}
          onSelect={setSelectedId}
          selectedId={selected.id}
          size={size}
        />
      </div>

      {/* Featured block is its own width budget — never inherits strip track width. */}
      <div
        className={cn(
          "mx-auto flex w-full min-w-0 max-w-xs flex-col items-center",
          size === "compact" ? "mt-4" : "mt-5",
        )}
        data-testid="landing-selected-block"
      >
        <p
          className={cn(
            "font-semibold tracking-[-0.01em]",
            size === "compact" ? "text-lg" : "text-xl",
          )}
          data-testid="landing-selected-name"
        >
          {selected.name}
        </p>

        {/* Always reserve two caption lines so empty/wrapping captions cannot
            shift Start chat when the middle column is vertically centred. */}
        <p
          className={cn(
            "text-muted-foreground line-clamp-2 w-full leading-snug",
            size === "compact"
              ? "mt-1 min-h-[2.4375rem] text-[0.8125rem]"
              : "mt-1.5 min-h-[2.5rem] text-sm",
          )}
          data-testid="landing-selected-caption"
        >
          {selectedCaption ?? "\u00a0"}
        </p>

        <div className="mt-4 w-full min-w-0" data-testid="landing-start-chat">
          <StartChatButton
            className={cn("w-full", startChatClassName)}
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
    </div>
  );
}
