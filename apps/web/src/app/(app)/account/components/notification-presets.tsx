"use client";

import {
  Bell,
  BellOff,
  ChevronDown,
  Inbox,
  type LucideIcon,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  type KindSpec,
  PRESET_LABEL_KEY,
  type PresetSpec,
  type PresetState,
  presetPushes,
  presetStops,
} from "./notification-delivery";

/** Custom is not one of the situations, so no table holds its sentence. */
const CUSTOM_HINT_KEY = "presetCustomHint";

/**
 * What a group is set to, and what it opens.
 *
 * Square-cornered like the box it sits in and the cells below it, and no
 * wider than the word it is showing. It carries the mark of the situation on
 * the left and the mark of a menu on the right, so it reads as one control
 * rather than as a word that happens to be tinted.
 */
const TRIGGER =
  "focus-visible:ring-ring/50 inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border pr-2 pl-2.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-[3px]";

/**
 * The mark each situation carries, beside its word.
 *
 * Inbox for the loudest, because it is the one that lets everything through;
 * a star for what is addressed to you; a bell for Sokosumi and a struck bell
 * for silence, which are the same two marks the cells of those columns carry.
 */
const PRESET_ICON: Record<PresetState, LucideIcon> = {
  MOST: Inbox,
  ESSENTIAL: Star,
  APP_ONLY: Bell,
  OFF: BellOff,
  CUSTOM: SlidersHorizontal,
};

/**
 * The kinds one situation reaches or stops, under its own sentence.
 *
 * The sentence says what the situation is; these say which rows it means, and
 * which rows it takes away. Each list is left out where it would name every
 * kind of the group or none of them, because a situation that pushes all of
 * them and one that stops all of them already say so in their own word.
 */
function MenuLists({
  pushes,
  stops,
}: {
  pushes: readonly string[];
  stops: readonly string[];
}) {
  const t = useTranslations("App.Account.Notifications");

  return (
    <>
      {pushes.length > 0 ? (
        <span className="text-muted-foreground block text-xs leading-snug">
          {t("channelPush")}: {pushes.join(", ")}
        </span>
      ) : null}
      {stops.length > 0 ? (
        <span className="text-muted-foreground block text-xs leading-snug">
          {t("presetStopsLabel")}: {stops.join(", ")}
        </span>
      ) : null}
    </>
  );
}

/**
 * A group's answer: the situation it is set to.
 *
 * One control rather than a row of them. The four situations are exclusive and
 * the reader picks one at a time, which is what a menu is for; drawn as four
 * buttons they take the width of the row and repeat three times down the card,
 * and the group's own name has to move under them to fit. Closed, this says
 * what the group is set to in one word, which is the thing a reader scanning
 * the card came for.
 *
 * One press writes every cell of the group, so the word is true of the rows
 * under it rather than nearly true. The rows are where the reader goes to
 * disagree with it, one notification at a time, and the answer says Custom
 * while they do.
 *
 * Custom is not one of the situations. It is under them rather than among
 * them, because it writes nothing: it opens the fold, and the kinds answer for
 * themselves in there.
 */
export function GroupAnswer({
  group,
  kinds,
  presets,
  preset,
  saving,
  onPick,
  onCustom,
}: {
  group: string;
  kinds: readonly KindSpec[];
  presets: readonly PresetSpec[];
  preset: PresetState;
  /** A write is in flight. The answer stays reachable, and does nothing. */
  saving: boolean;
  onPick: (preset: PresetSpec) => void;
  /** Open the group, for the answer that is the rows rather than a situation. */
  onCustom: () => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  const label = t("presetAriaLabel", { group });
  const hintId = useId();
  const Icon = PRESET_ICON[preset];

  /** The kinds one situation sends to the device, and the ones it stops. */
  const named = (one: PresetSpec) => ({
    pushes: presetPushes(one, kinds).map((kind) => t(kind.labelKey)),
    stops: presetStops(one, kinds).map((kind) => t(kind.labelKey)),
  });

  return (
    <>
      {/* The group's name, said once for the control rather than four times
          over. Left visible it would be the group's name a second time, after
          the row it names and out of nowhere. */}
      <span aria-hidden="true" id={hintId} className="sr-only">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          // Reachable while a write is in flight, and doing nothing: a control
          // the browser disables drops out of the tab order under the reader's
          // finger, and a screen reader loses the control it was on.
          aria-disabled={saving || undefined}
          aria-describedby={hintId}
          className={cn(
            TRIGGER,
            // On a situation it is a plain control; off every one of them it
            // says the group is on settings of its own, as loudly as a chosen
            // word does.
            preset === "CUSTOM"
              ? "border-primary bg-primary/10 text-primary"
              : "border-input bg-background",
            saving && "opacity-50",
          )}
        >
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              preset === "CUSTOM" ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          {t(PRESET_LABEL_KEY[preset])}
          <ChevronDown
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        {/* Hung from the edge the control sits on, which is the right of the
            row it answers for. */}
        <DropdownMenuContent align="end" className="w-72">
          {/* Custom is not one of the situations, so the radio group holds none
              of them and nothing is ticked. The heading says why rather than
              leaving the reader to wonder what they are looking at. */}
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {preset === "CUSTOM"
              ? t("presetMenuCustomLabel", { group })
              : group}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preset}
            onValueChange={(next) => {
              const picked = presets.find((one) => one.id === next);

              if (saving || !picked) {
                return;
              }

              onPick(picked);
            }}
          >
            {presets.map((one) => (
              <DropdownMenuRadioItem
                key={one.id}
                value={one.id}
                // The trigger says it is busy and the guard above refuses the
                // write. Left selectable, each of these would announce as a
                // choice and then do nothing, silently.
                disabled={saving}
                className="items-start py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">
                    {t(PRESET_LABEL_KEY[one.id])}
                  </span>
                  <span className="text-muted-foreground block text-xs leading-snug">
                    {t(one.hintKey)}
                  </span>
                  <MenuLists {...named(one)} />
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="items-start py-2" onSelect={onCustom}>
            <SlidersHorizontal
              className="text-muted-foreground mt-0.5 size-3.5"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">
                {t(PRESET_LABEL_KEY.CUSTOM)}
              </span>
              <span className="text-muted-foreground block text-xs leading-snug">
                {t(CUSTOM_HINT_KEY)}
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
