"use client";

import { BellRing, type LucideIcon, Mail, Smartphone } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DisplayChannel, TriState } from "./notification-model";

export const CHANNEL_ICON: Record<DisplayChannel, LucideIcon> = {
  IN_APP: BellRing,
  OS_BANNER: Smartphone,
  EMAIL: Mail,
};

interface ChannelChipProps {
  channel: DisplayChannel;
  label: string;
  state: TriState;
  /** Hides the label and keeps the icon. The tooltip then carries the name. */
  iconOnly?: boolean;
  disabled?: boolean;
  /** Why it cannot be changed, when it cannot. Shown in a tooltip. */
  reason?: string | null;
  busy?: boolean;
  /** Named for the reader, not for the layout: "Tasks, banner". */
  ariaLabel: string;
  onToggle: (next: boolean) => void;
  className?: string;
}

/**
 * One channel, as a chip that carries its own state.
 *
 * A plain button with `aria-pressed` rather than a toggle group, because the
 * chips have to survive being wrapped (a tooltip needs a wrapper on a disabled
 * control) and being laid out in a grid, and a roving-focus group fights both.
 * Three states: a chip that stands for several cells can be mixed.
 */
export function ChannelChip({
  channel,
  label,
  state,
  iconOnly = false,
  disabled = false,
  reason = null,
  busy = false,
  ariaLabel,
  onToggle,
  className,
}: ChannelChipProps) {
  const Icon = CHANNEL_ICON[channel];

  const chip = (
    <button
      type="button"
      // A chip standing for several cells reports "mixed", which is the state
      // a plain checkbox could not say out loud.
      aria-pressed={state === "mixed" ? "mixed" : state === "on"}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => {
        // Mixed means some are on, so the useful next step is all on.
        onToggle(state !== "on");
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border font-medium whitespace-nowrap transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        iconOnly ? "size-9" : "h-9 px-3.5 text-sm",
        state === "off" &&
          "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        state === "on" && "border-primary/40 bg-primary/10 text-primary",
        state === "mixed" &&
          "border-primary/40 border-dashed bg-primary/5 text-primary",
        !disabled && state !== "off" && "hover:bg-primary/15",
        disabled &&
          "border-dashed opacity-60 hover:bg-transparent hover:text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" />
      {iconOnly ? null : <span className="truncate">{label}</span>}
    </button>
  );

  // An icon-only chip has to name itself. When it also cannot be used, it says
  // both: the name alone leaves the reader guessing why it does nothing.
  const tooltip = iconOnly
    ? [label, reason].filter(Boolean).join(". ")
    : reason;

  if (!tooltip) {
    return chip;
  }

  return (
    <Tooltip>
      {/* A disabled button fires no pointer events, so the trigger has to be
          the wrapper rather than the chip itself. */}
      <TooltipTrigger asChild>
        <span className="inline-flex">{chip}</span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
