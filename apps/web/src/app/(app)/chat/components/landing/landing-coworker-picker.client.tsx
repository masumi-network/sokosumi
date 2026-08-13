"use client";

import { useState } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import { cn } from "@/lib/utils";

import { CoworkerStrip } from "./coworker-strip.client";
import { featuredCoworkerRole, toStripCoworker } from "./landing-content";
import { StartChatButton } from "./start-chat-button.client";

interface LandingCoworkerPickerProps {
  coworkers: Coworker[];
  /** Elena (or fallback) — default selection before the user taps. */
  initialSelectedId: string;
  /** Product pitch for Elena under the strip. */
  elenaRole: string;
  size?: "compact" | "default";
  /** Mobile passes `w-full` so the CTA spans the column. */
  startChatClassName?: string;
}

/**
 * Landing strip + details + Start chat.
 *
 * Strip taps only change selection. Opening a DM waits for Start chat.
 */
export function LandingCoworkerPicker({
  coworkers,
  initialSelectedId,
  elenaRole,
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

  // Stable browse order: default featured first, then the rest of the catalog.
  const ordered = [
    initial,
    ...coworkers.filter((coworker) => coworker.id !== initial.id),
  ];
  const stripCoworkers = ordered.map(toStripCoworker);
  const selectedRole = featuredCoworkerRole(selected, elenaRole);

  return (
    <>
      <div className={cn(size === "compact" ? "mt-8" : "mt-12", "w-full")}>
        <CoworkerStrip
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
      >
        {selected.name}
      </p>
      {selectedRole ? (
        <p
          className={cn(
            "text-muted-foreground text-balance",
            size === "compact"
              ? "mt-1.5 max-w-[40ch] text-[0.8125rem] leading-[1.5]"
              : "mx-auto mt-2 max-w-[46ch] text-[0.9375rem] leading-[1.55]",
          )}
        >
          {selectedRole}
        </p>
      ) : null}

      <div className={cn("mt-6", size === "compact" && "w-full max-w-xs")}>
        <StartChatButton
          className={startChatClassName}
          coworkerId={selected.id}
          coworkerName={selected.name}
        />
      </div>
    </>
  );
}
