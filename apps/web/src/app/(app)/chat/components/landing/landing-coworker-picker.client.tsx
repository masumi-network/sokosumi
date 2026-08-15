"use client";

import { useState } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import { cn } from "@/lib/utils";

import { CoworkerStrip } from "./coworker-strip.client";
import {
  orderStripCoworkers,
  selectedCoworkerDescription,
} from "./landing-content";
import { LandingSelectedDescription } from "./landing-selected-description.client";
import { StartChatButton } from "./start-chat-button.client";

interface LandingCoworkerPickerProps {
  coworkers: Coworker[];
  /** Most popular coworker — default selection before the user taps. */
  initialSelectedId: string;
  size?: "compact" | "default";
  /** Mobile passes `w-full` so the CTA spans the column. */
  startChatClassName?: string;
}

/**
 * Landing strip + details + Start chat.
 *
 * The strip already shows name + role under each avatar and is full-bleed
 * within the landing column (no horizontal page pad on the strip or its
 * overflow ancestors). The selected block below is one sentence → Start chat
 * only — no second identity heading — and keeps `px-4` + `max-w-xs` so copy
 * and CTA stay inset. The picker is viewport-bounded (`w-full min-w-0`) so
 * the strip's w-max track cannot widen Start chat. Description slots keep
 * a two-line min-height (including empty) so selection cannot jump the CTA.
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
          size === "compact" ? "mt-6" : "mt-10 lg:mt-14",
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
          Description → CTA only; identity (name + role) lives under the strip
          avatar. Reserved two-line slot keeps CTA stable across selection. */}
      <div
        className={cn(
          "mx-auto flex w-full min-w-0 max-w-xs flex-col items-center justify-start px-4",
          size === "compact" ? "mt-4" : "mt-6 lg:mt-8",
        )}
        data-testid="landing-selected-block"
      >
        <div
          className="flex w-full shrink-0 flex-col items-center"
          data-testid="landing-selected-cta-stack"
        >
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
