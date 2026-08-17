"use client";

import { useState } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import { cn } from "@/lib/utils";

import { CoworkerStrip } from "./coworker-strip.client";
import { orderStripCoworkers } from "./landing-content";
import { StartChatButton } from "./start-chat-button.client";

interface LandingCoworkerPickerProps {
  coworkers: Coworker[];
  /** Highest-priority coworker — default selection before the user taps. */
  initialSelectedId: string;
  size?: "compact" | "default";
  /** Mobile passes `w-full` so the CTA spans the column. */
  startChatClassName?: string;
  /** Optional trailing action for the strip (mobile only). */
  trailingAction?: React.ReactNode;
}

/**
 * Landing strip + details + Start chat.
 *
 * The strip already shows name + role under each avatar and is full-bleed
 * within the landing column (no horizontal page pad on the strip or its
 * overflow ancestors). The selected block is Start chat only — no second
 * identity heading, no description. `px-4` + `max-w-xs` keep the CTA inset.
 * The picker is viewport-bounded (`w-full min-w-0`) so the strip's w-max
 * track cannot widen Start chat.
 */
export function LandingCoworkerPicker({
  coworkers,
  initialSelectedId,
  size = "default",
  startChatClassName,
  trailingAction,
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
          trailingAction={trailingAction}
        />
      </div>

      {/* CTA is its own width budget — never inherits strip track width.
          Identity (name + role) lives under the strip avatar. Extra large-
          screen margin drops Start chat slightly in the pane. */}
      <div
        className={cn(
          "mx-auto flex w-full min-w-0 max-w-xs flex-col items-center justify-start px-4",
          size === "compact" ? "mt-6" : "mt-10 lg:mt-16 xl:mt-20",
        )}
        data-testid="landing-selected-block"
      >
        <div
          className="flex w-full shrink-0 flex-col items-center"
          data-testid="landing-selected-cta-stack"
        >
          <div className="w-full min-w-0" data-testid="landing-start-chat">
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
