"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
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
  groupPresets,
  type KindSpec,
  PRESET_HINT_KEY,
  PRESET_LABEL_KEY,
  type Preset,
  type PresetState,
  presetPushes,
  presetStops,
} from "./notification-delivery";

/**
 * The one control a group answers with.
 *
 * A rail of chips carried the three answers this used to offer. Six situations
 * do not fit one, and each of them needs a sentence to be worth picking: how
 * many of the group's notifications arrive, and whether they reach the device.
 * So the answers live in a menu, which has room for the sentence and is the
 * same control at every width. The word on the button is the situation the
 * group is in.
 *
 * `transition-[color,background-color,border-color,scale]` rather than
 * `transition`, which names every property including the focus ring and would
 * fade it in behind the reader's tab.
 */
const TRIGGER =
  "focus-visible:ring-ring/50 inline-flex h-8 max-w-full items-center gap-2 rounded-lg border pr-2 pl-3 text-xs font-medium transition-[color,background-color,border-color,scale] outline-none focus-visible:ring-[3px] motion-safe:active:scale-95";

/**
 * One situation, as a line the reader can decide from.
 *
 * The name says how much arrives and how loudly, and the sentence under it
 * says what that means for the two columns. Under those, the kinds it treats
 * differently from the rest: "what matters" is two named things in Jobs and
 * two others in Chat, and no sentence the groups share can say which. The
 * lists name them, and each is left out where it would name every kind of the
 * group or none of them.
 *
 * The device list is headed by that column's own name, so a reader who just
 * read the legend above the rows meets the same word here.
 */
function PresetItem({
  label,
  hint,
  pushes,
  stops,
}: {
  label: string;
  hint: string;
  /** The kinds this one sends to the device, by name. */
  pushes?: readonly string[];
  /** The kinds this one stops, by name. */
  stops?: readonly string[];
}) {
  const t = useTranslations("App.Account.Notifications");
  const lists = [
    { key: "channelPush", names: pushes ?? [] },
    { key: "presetStopsLabel", names: stops ?? [] },
  ].filter((list) => list.names.length > 0);

  return (
    <span className="min-w-0 flex-1 space-y-0.5">
      <span className="block text-xs font-medium">{label}</span>
      <span className="text-muted-foreground block text-xs leading-snug">
        {hint}
      </span>
      {lists.map((list) => (
        <span
          key={list.key}
          className="text-muted-foreground/80 block text-xs leading-snug"
        >
          {t(list.key)}: {list.names.join(", ")}
        </span>
      ))}
    </span>
  );
}

/**
 * A group's answer: the situation it is set to.
 *
 * One press writes every cell of the group, so the word on the button is true
 * of the rows under it rather than nearly true. The rows are where the reader
 * goes to disagree with it, one notification at a time, and the button says
 * Custom while they do.
 *
 * Custom is not one of the situations. It writes nothing and opens the group
 * instead, which is where the reader answers for themselves, so it sits under
 * the others behind a rule rather than inside the list they pick from.
 */
export function GroupAnswer({
  group,
  kinds,
  preset,
  saving,
  onPick,
  onCustom,
}: {
  group: string;
  kinds: readonly KindSpec[];
  preset: PresetState;
  /** A write is in flight. The menu stays reachable, and does nothing. */
  saving: boolean;
  onPick: (preset: Preset) => void;
  /** Open the group, for the answer that is the rows rather than a preset. */
  onCustom: () => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  const presets = groupPresets(kinds);
  const labelId = useId();

  /** The kinds one situation pushes, and the kinds it stops, by name. */
  const named = (answer: Preset) => ({
    pushes: presetPushes(answer, kinds).map((kind) => t(kind.labelKey)),
    stops: presetStops(answer, kinds).map((kind) => t(kind.labelKey)),
  });

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs">{t("presetLead")}</span>
      {/* The button's own word is its name, and the sentence naming the group
          comes after it: four of these on a page are four different controls
          to a screen reader, and the word on the button is still the word it
          is announced by. */}
      <span aria-hidden="true" id={labelId} className="sr-only">
        {t("presetAriaLabel", { group })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          // Reachable while a write is in flight, and doing nothing: a
          // control the browser disables drops out of the tab order under the
          // reader's finger, and a screen reader loses the control it was on.
          aria-disabled={saving || undefined}
          aria-describedby={labelId}
          className={cn(
            TRIGGER,
            // On a preset it is a plain control. Off every preset it carries
            // the mark a picked answer carries, because Custom is the state
            // the group is in rather than an offer standing open.
            preset === "CUSTOM"
              ? "border-primary bg-primary/10 text-primary"
              : "border-input bg-background",
            saving && "opacity-50",
          )}
        >
          <span className="truncate">{t(PRESET_LABEL_KEY[preset])}</span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0",
              preset === "CUSTOM" ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {/* Custom is none of the answers below, so the radio group holds no
              tick. The heading says why rather than leaving the reader to
              wonder what they are looking at. */}
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {preset === "CUSTOM"
              ? t("presetMenuCustomLabel", { group })
              : group}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preset}
            onValueChange={(next) => {
              if (saving) {
                return;
              }

              onPick(next as Preset);
            }}
          >
            {presets.map((answer) => (
              <DropdownMenuRadioItem
                key={answer}
                value={answer}
                // The trigger says it is busy and the guard above refuses the
                // write. Left selectable, each of these would announce as a
                // choice and then do nothing, silently.
                disabled={saving}
                className="items-start py-2"
              >
                <PresetItem
                  label={t(PRESET_LABEL_KEY[answer])}
                  hint={t(PRESET_HINT_KEY[answer])}
                  {...named(answer)}
                />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {/* Opens the group rather than toggling it: a reader who picked it
              from a menu asked to see the rows, and closing them is not what
              the word says. */}
          <DropdownMenuItem className="items-start py-2" onSelect={onCustom}>
            <SlidersHorizontal
              className="text-muted-foreground mt-0.5 size-3.5"
              aria-hidden="true"
            />
            <PresetItem
              label={t(PRESET_LABEL_KEY.CUSTOM)}
              hint={t(PRESET_HINT_KEY.CUSTOM)}
            />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
