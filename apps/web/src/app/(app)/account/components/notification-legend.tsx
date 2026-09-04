"use client";

import { type LucideIcon, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CHANNEL_ICON } from "./notification-cells";
import {
  CHANNEL_SPECS,
  PUSH_BLOCK_HINT_KEY,
  type PushBlock,
} from "./notification-delivery";

/**
 * A column's name, sized to sit over its cells on a wide screen.
 *
 * The dotted underline is the whole of the invitation: it is what a reader has
 * learned means a word will explain itself. The cells under it carry no such
 * mark and open nothing, because a grid of thirty icons that all speak on
 * contact is a grid nobody can cross.
 */
const NAME =
  "focus-visible:ring-ring/50 decoration-muted-foreground/60 flex cursor-help items-center gap-1.5 rounded-sm underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-[3px] sm:w-9 sm:justify-center sm:gap-0";

/**
 * What arriving on one channel means, on hover and on a tap.
 *
 * A tooltip would answer the pointer and nothing else: Radix closes one on
 * touch, so a phone would meet three column names that explain nothing. A
 * popover opens on a press, which is the same press on a phone, a mouse and
 * the keyboard, and hover is added on top for the reader who is already
 * pointing at it.
 *
 * Focus follows the press and not the pointer. Opened by hover, the panel
 * takes the caret out of the page while the reader is on their way somewhere
 * else; opened by a press, moving into it is exactly what was asked for.
 */
function ChannelExplainer({
  icon: Icon,
  label,
  hint,
  notes,
}: {
  icon: LucideIcon;
  label: string;
  /** What the column is for, in the words the columns are named in. */
  hint: string;
  /** What is standing in the way here, a line at a time. */
  notes: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const byPointer = useRef(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          byPointer.current = false;
        }

        setOpen(next);
      }}
    >
      <PopoverTrigger
        className={NAME}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") {
            return;
          }

          byPointer.current = true;
          setOpen(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse" || !byPointer.current) {
            return;
          }

          setOpen(false);
        }}
        onClick={(event) => {
          // The press that arrives with the pointer must not close what the
          // pointer just opened. Radix toggles on click and skips its own
          // handler when ours has already spoken for the event, so a mouse
          // reader gets one panel rather than a flicker.
          if (byPointer.current) {
            event.preventDefault();
          }
        }}
      >
        <Icon className="size-3.5 shrink-0 sm:hidden" aria-hidden="true" />
        {label}
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-72 space-y-1.5 p-3 text-xs"
        onOpenAutoFocus={(event) => {
          if (byPointer.current) {
            event.preventDefault();
          }
        }}
      >
        <p className="flex items-center gap-1.5 font-medium">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          {label}
        </p>
        <p className="text-muted-foreground leading-relaxed">{hint}</p>
        {notes.length > 0 ? (
          <div className="space-y-1 border-t pt-1.5">
            {notes.map((note) => (
              <p key={note} className="text-muted-foreground leading-relaxed">
                {note}
              </p>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The columns, named once for the whole card and able to explain themselves.
 *
 * Every row right-aligns its cells into the same column, so one line of names
 * covers all of them, and the names are where the explanation belongs: a
 * channel means the same thing on every row under it.
 *
 * Wide, the names sit over their own columns on the line's floor, so a name
 * that wraps in one language does not lift its column. Narrow, the columns are
 * too tight for a word that explains itself, so the names fall back into a
 * legend at the start of the line, each with the icon its cells carry.
 */
export function ChannelLegend({ pushBlock }: { pushBlock: PushBlock | null }) {
  const t = useTranslations("App.Account.Notifications");

  return (
    <div
      role="group"
      aria-label={t("channelsLegendLabel")}
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3 pb-2 text-xs",
        "sm:flex-nowrap sm:items-end sm:justify-end sm:gap-2",
      )}
    >
      {CHANNEL_SPECS.map((spec) => (
        <ChannelExplainer
          key={spec.id}
          icon={CHANNEL_ICON[spec.id]}
          label={t(spec.labelKey)}
          hint={t(spec.hintKey)}
          // Only the push column has anything in its way, and only on the
          // browser the reader is holding. The banner over the rows says the
          // same, and says it once; here it is beside the word it is about,
          // for a reader who arrived at the column rather than at the banner.
          notes={
            spec.id === "OS_BANNER" && pushBlock
              ? [t(PUSH_BLOCK_HINT_KEY[pushBlock]), t("pushOtherDevicesHint")]
              : []
          }
        />
      ))}
      <ChannelExplainer
        icon={Mail}
        label={t("channelEmail")}
        hint={t("channelEmailHint")}
        notes={[]}
      />
    </div>
  );
}
