"use client";

import { type LucideIcon, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CELL_TRACK, CHANNEL_ICON } from "./notification-cells";
import {
  CHANNEL_SPECS,
  PUSH_BLOCK_HINT_KEY,
  type PushBlock,
} from "./notification-delivery";

/**
 * A column's name, filling the column its cells stand in.
 *
 * The dotted underline is the whole of the invitation: it is what a reader has
 * learned means a word will explain itself. The cells under it carry no such
 * mark and open nothing, because a grid of thirty icons that all speak on
 * contact is a grid nobody can cross.
 *
 * No icon here. Every cell in the column below carries the channel's icon
 * already, so a head that carried it too would draw the same mark four times
 * down one column and take the width the word needs.
 */
const NAME = cn(
  CELL_TRACK,
  "focus-visible:ring-ring/50 decoration-muted-foreground/60 cursor-help items-center rounded-sm text-center leading-tight underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-[3px]",
);

/**
 * How long the panel waits before it closes behind the pointer.
 *
 * It sits 4px off the name it explains, and Radix takes the panel out of the
 * page the moment it closes. Closed on the leave itself, it would be gone
 * before the pointer had crossed the gap, and three sentences a mouse can see
 * would be three a mouse can never reach. Long enough to cross 4px, short
 * enough that a pointer on its way elsewhere does not drag the panel along.
 */
const CLOSE_DELAY_MS = 150;

/** The email column stands outside `CHANNEL_SPECS` and needs a name of its own. */
const EMAIL_NAME = "email";

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
  open,
  onOpenChange,
}: {
  icon: LucideIcon;
  label: string;
  /** What the column is for, in the words the columns are named in. */
  hint: string;
  /** What is standing in the way here, a line at a time. */
  notes: readonly string[];
  /** This name is the one of the row holding the panel. */
  open: boolean;
  /** Ask the row for the panel, or hand it back. */
  onOpenChange: (open: boolean) => void;
}) {
  const byPointer = useRef(false);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const holdOpen = () => {
    if (closing.current) {
      clearTimeout(closing.current);
      closing.current = null;
    }
  };

  const closeSoon = () => {
    holdOpen();
    closing.current = setTimeout(() => {
      // The pointer's claim on the panel ends with the panel. This close is
      // ours rather than Radix's, so `onOpenChange` never runs and nothing
      // else puts the flag down; left standing, the press handler below goes
      // on refusing every press, and Enter and Space open nothing ever again.
      byPointer.current = false;
      onOpenChange(false);
    }, CLOSE_DELAY_MS);
  };

  // Nothing else stops the timer. A reader who leaves the name and then leaves
  // the page has a close waiting on a component that is gone.
  useEffect(() => holdOpen, []);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          byPointer.current = false;
        }

        holdOpen();
        onOpenChange(next);
      }}
    >
      <PopoverTrigger
        className={NAME}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") {
            return;
          }

          holdOpen();
          byPointer.current = true;
          onOpenChange(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse" || !byPointer.current) {
            return;
          }

          closeSoon();
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
        {label}
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-72 space-y-1.5 p-3 text-xs"
        // The panel takes the close over from the name. The pointer arrives
        // here inside the wait the leave started, and this stops it; leaving
        // here starts it again. Radix still dismisses on Escape and on a
        // press outside.
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") {
            return;
          }

          holdOpen();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse" || !byPointer.current) {
            return;
          }

          closeSoon();
        }}
        onOpenAutoFocus={(event) => {
          if (byPointer.current) {
            event.preventDefault();
          }
        }}
        // And it must not take the caret back on the way out. Radix returns
        // focus to the name it came from when the panel goes, which for a
        // panel the pointer opened means the caret is dragged along behind a
        // mouse that was never asking for it. It also puts focus outside the
        // panel the pointer has just arrived at, and that panel dismisses
        // itself on the spot.
        onCloseAutoFocus={(event) => {
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
 * The columns, named once at the top of an open group.
 *
 * Every row right-aligns its cells into the same three columns, so one line of
 * names over them names the cells of the whole group. The names are where the
 * explanation belongs: a channel means the same thing on every kind under it.
 *
 * Each name holds the width of the column it sits over, so the word and the
 * cells under it share both edges. Under the line is the rule the rows are
 * divided by, which is what makes it read as a head rather than as a gap.
 *
 * The left column is named too, over the kinds rather than over cells. Three
 * words crowded against the right edge of an otherwise empty band read as
 * something that fell off the row above; named on both sides, the band is a
 * head. A phone has no width to spare for the word, and the names of the
 * columns need what there is, so there it is left out.
 */
export function ChannelLegend({
  pushBlock,
  named = false,
}: {
  pushBlock: PushBlock | null;
  /** The rows under this head carry their kind's name. */
  named?: boolean;
}) {
  const t = useTranslations("App.Account.Notifications");
  const [openName, setOpenName] = useState<string | null>(null);

  /**
   * One panel at a time, held by the row rather than by each name.
   *
   * Each name closes behind the pointer on a wait, so a pointer crossing the
   * row arrives at the next name while the one it came from is still counting
   * down: two panels 288px wide, overlapping, over the rows they explain. Held
   * here, the name being arrived at takes the panel and the one being left
   * loses it in the same paint.
   *
   * The close still goes through the name that asked for it. It comes in late
   * by design, and by then the panel may belong to a name further along the
   * row, which this must not take away.
   */
  const answerFor = (name: string) => (open: boolean) => {
    setOpenName((current) => (open ? name : current === name ? null : current));
  };

  return (
    <div
      role="group"
      aria-label={t("channelsLegendLabel")}
      className="text-muted-foreground flex items-end justify-end gap-2 pt-2.5 pb-1.5 text-xs"
    >
      {named ? (
        // Lined up with the kind names below it, which is the whole of what it
        // is doing here.
        <span className="hidden min-w-0 flex-1 pr-3 pl-6 @xl:block @xl:pl-10">
          {t("channelsKindLabel")}
        </span>
      ) : null}
      {CHANNEL_SPECS.map((spec) => (
        <ChannelExplainer
          key={spec.id}
          open={openName === spec.id}
          onOpenChange={answerFor(spec.id)}
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
        open={openName === EMAIL_NAME}
        onOpenChange={answerFor(EMAIL_NAME)}
        icon={Mail}
        label={t("channelEmail")}
        hint={t("channelEmailHint")}
        notes={[]}
      />
    </div>
  );
}
