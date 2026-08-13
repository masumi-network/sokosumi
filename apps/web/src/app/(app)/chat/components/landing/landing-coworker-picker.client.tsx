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
 * Order under the strip: name → caption → description → Start chat.
 * The strip is full-bleed within the landing column (no horizontal page pad on
 * the strip or its overflow ancestors). The selected block keeps `px-4` +
 * `max-w-xs` so name/caption/CTA stay inset. The picker is viewport-bounded
 * (`w-full min-w-0`) so the strip's w-max track cannot widen Start chat.
 * Caption and collapsed description slots keep fixed min-heights (including
 * empty) so selection cannot jump the CTA. Expanding More grows the
 * description downward and may shift Start chat; Less restores.
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
  const selectedDescription = selectedCoworkerDescription(selected) ?? "";

  return (
    <div
      className="w-full min-w-0 max-w-full"
      data-testid="landing-coworker-picker"
    >
      {/* Full-width strip — must not sit inside page `px-*` / max-w that would
          inset + clip edge avatars. Landing compositions pad pitch/stats only. */}
      <div
        className={cn(
          "w-full min-w-0 max-w-full",
          size === "compact" ? "mt-6" : "mt-10",
        )}
        data-testid="landing-coworker-strip"
      >
        <CoworkerStrip
          centerOnId={initial.id}
          coworkers={stripCoworkers}
          onSelect={setSelectedId}
          selectedId={selected.id}
          size={size}
        />
      </div>

      {/* Featured block is its own width budget — never inherits strip track width.
          Name → caption → description → CTA; reserved slots keep CTA stable
          across selection; More is the only intentional CTA shift. */}
      <div
        className={cn(
          "mx-auto flex w-full min-w-0 max-w-xs flex-col items-center justify-start px-4",
          size === "compact" ? "mt-4" : "mt-5",
        )}
        data-testid="landing-selected-block"
      >
        <div
          className="flex w-full shrink-0 flex-col items-center"
          data-testid="landing-selected-cta-stack"
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
              shift Start chat relative to the top-aligned stack. */}
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

          <LandingSelectedDescription
            coworkerId={selected.id}
            description={selectedDescription}
            size={size}
          />

          <div className="mt-4 w-full min-w-0" data-testid="landing-start-chat">
            <StartChatButton
              className={cn("w-full", startChatClassName)}
              coworkerId={selected.id}
              coworkerName={selected.name}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
