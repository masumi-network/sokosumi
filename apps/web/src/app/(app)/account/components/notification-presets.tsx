"use client";

import {
  Bell,
  BellOff,
  CircleCheck,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type KindSpec,
  PRESET_LABEL_KEY,
  type PresetSpec,
  type PresetState,
  presetPushes,
  presetStops,
} from "./notification-delivery";

/**
 * The rail the situations sit in.
 *
 * Square-cornered like everything it sits with: the cells are `rounded-md` and
 * the box around the whole group is `rounded-lg`, and a pill here would be the
 * one round thing in the row. The rail keeps the outer radius and its stops
 * the inner one, which differ by exactly the padding between them, so the
 * corners stay concentric instead of leaving a crescent at each end.
 *
 * It carries no display of its own. The rail and the menu below take turns by
 * width, and `hidden` loses to an `inline-flex` sitting in the same list.
 */
const RAIL = "border-input bg-background shrink-0 rounded-lg border p-0.5";

const STOP =
  "focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-[color,background-color,border-color,scale] outline-none focus-visible:ring-[3px] motion-safe:active:scale-95";

const STOP_ON = "bg-primary/10 text-primary";
const STOP_OFF = "text-muted-foreground hover:text-foreground";

/**
 * The mark each situation carries, beside its word.
 *
 * Read across the rail they are an amount: everything that lands, then the
 * results of the work, then the ones addressed to you, then a bell that stays
 * in Sokosumi, then a bell struck through. The last two are the same bell, so
 * the quiet end of the rail reads as one idea rather than two.
 *
 * In app borrows the bell the In app column carries in the legend, so the word
 * and the column a reader just read about are the same thing.
 */
const PRESET_ICON: Record<PresetState, LucideIcon> = {
  EVERYTHING: Inbox,
  RESULTS: CircleCheck,
  ESSENTIAL: Star,
  APP_ONLY: Bell,
  OFF: BellOff,
  CUSTOM: SlidersHorizontal,
};

/**
 * The panel a stop opens under the pointer.
 *
 * Every stop is one word, which is the point: four of them read at a glance
 * where four sentences would have to be read one at a time. A word cannot say
 * what it writes, so the sentence waits under the pointer, with the kinds it
 * pushes and the kinds it stops named under that.
 *
 * `animation-duration-200` rather than `duration-200`, which sets a transition
 * duration on an element whose transition property is still `all` and puts
 * every later change on a 200ms ease it never asked for.
 */
const PANEL =
  "max-w-72 px-3 py-2 text-left text-xs motion-safe:animation-duration-200 ease-out";

/**
 * The beat before a panel opens, and the gap it stands off at.
 *
 * The stops sit flush inside the rail, so a pointer on its way across it
 * crosses all four. Opening on contact, each would flash a paragraph and two
 * lists. A reader who means to read one holds still for longer.
 */
const TIP_DELAY_MS = 200;
const TIP_OFFSET_PX = 6;

/**
 * What one situation does, in the words the reader needs to decide.
 *
 * The lists are the part the sentence cannot carry twice: it says what the
 * situation is, and these say which rows it means. The device list is headed
 * by that column's own name, so a reader who just read the legend meets the
 * same word here.
 *
 * Each list is left out where it would name every kind of the group or none of
 * them: a situation that pushes all of them and one that stops all of them
 * already say so in their own word.
 */
function PresetBody({
  label,
  hint,
  pushes,
  stops,
}: {
  label: string;
  hint: string;
  /** The kinds this one sends to the device, by name. */
  pushes: readonly string[];
  /** The kinds this one stops, by name. */
  stops: readonly string[];
}) {
  const t = useTranslations("App.Account.Notifications");
  const lists = [
    { key: "channelPush", names: pushes },
    { key: "presetStopsLabel", names: stops },
  ].filter((list) => list.names.length > 0);

  return (
    <div className="space-y-1.5">
      <p className="font-medium">{label}</p>
      <p className="text-primary-foreground/80 leading-relaxed">{hint}</p>
      {lists.length > 0 ? (
        <dl className="border-primary-foreground/20 space-y-1 border-t pt-1.5">
          {lists.map((list) => (
            <div key={list.key} className="flex gap-2">
              <dt className="text-primary-foreground/60 min-w-11 shrink-0">
                {t(list.key)}
              </dt>
              <dd className="min-w-0 flex-1">{list.names.join(", ")}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * The same words in one line, for the reader who hears the row.
 *
 * A tooltip exists only while it is open, so the panel is written into the row
 * as well, where `aria-describedby` can always reach it. The lists are read out
 * with their own labels rather than as a bare run of names.
 */
function presetSentence(
  hint: string,
  pushes: readonly string[],
  stops: readonly string[],
  label: (key: string) => string,
): string {
  return [
    hint,
    pushes.length > 0 ? `${label("channelPush")}: ${pushes.join(", ")}.` : "",
    stops.length > 0
      ? `${label("presetStopsLabel")}: ${stops.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The kinds one situation reaches or stops, for a reader with no pointer.
 *
 * The rail says this under the pointer. A phone has none, so the menu carries
 * the same two lines in the open rather than leaving its reader with the
 * sentence alone.
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

/** One stop of the rail, with what it does under the pointer and in the ear. */
function Stop({
  id,
  label,
  hint,
  pushes,
  stops,
  pressed,
  saving,
  onPick,
}: {
  id: PresetState;
  label: string;
  hint: string;
  pushes: readonly string[];
  stops: readonly string[];
  pressed: boolean;
  /** A write is in flight. The stop stays reachable, and does nothing. */
  saving: boolean;
  onPick: () => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  const hintId = useId();
  const Icon = PRESET_ICON[id];

  return (
    <>
      <Tooltip delayDuration={TIP_DELAY_MS}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-pressed={pressed}
            // Reachable while a write is in flight, and doing nothing: a
            // control the browser disables drops out of the tab order under
            // the reader's finger, and a screen reader loses the control it
            // was on.
            aria-disabled={saving || undefined}
            aria-describedby={hintId}
            onClick={() => {
              if (saving) {
                return;
              }

              onPick();
            }}
            className={cn(
              STOP,
              saving && "opacity-50",
              pressed ? STOP_ON : STOP_OFF,
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={TIP_OFFSET_PX} className={PANEL}>
          <PresetBody label={label} hint={hint} pushes={pushes} stops={stops} />
        </TooltipContent>
      </Tooltip>
      <span aria-hidden="true" id={hintId} className="sr-only">
        {presetSentence(hint, pushes, stops, t)}
      </span>
    </>
  );
}

/**
 * The same situations where the rail does not fit.
 *
 * Four words and a rail want about 400px once the lead in front of them is
 * counted, and the row gets the card's width less its padding and the
 * chevron's gutter. So the two take turns at `md`. Below it, a phone cannot
 * open a tooltip at all, so the list carries each sentence in the open rather
 * than under a pointer that does not exist.
 */
function AnswerMenu({
  label,
  presets,
  preset,
  group,
  saving,
  named,
  onPick,
  onCustom,
}: {
  label: string;
  presets: readonly PresetSpec[];
  preset: PresetState;
  group: string;
  saving: boolean;
  /** The kinds one situation pushes, and the ones it stops, by name. */
  named: (preset: PresetSpec) => { pushes: string[]; stops: string[] };
  onPick: (preset: PresetSpec) => void;
  onCustom: () => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  const hintId = useId();
  const Icon = PRESET_ICON[preset];

  return (
    // No group of its own. The rail is four buttons and needs one; this is a
    // single button, and a second group with the same name would be a name the
    // reader meets twice. The sentence it would have carried is the button's
    // description instead, so the visible word stays its name.
    <div className="md:hidden">
      <span aria-hidden="true" id={hintId} className="sr-only">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-disabled={saving || undefined}
          aria-describedby={hintId}
          className={cn(
            "focus-visible:ring-ring/50 inline-flex h-8 items-center gap-2 rounded-lg border pr-3 pl-2.5 text-xs font-medium outline-none focus-visible:ring-[3px]",
            // The same mark the rail's chip carries at the widths it is drawn
            // at: on a preset it is a plain control, and off every preset it
            // says the group is on settings of its own.
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
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
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
          {/* Not one of the situations, so it sits under them rather than in
              the radio group: it writes nothing and opens the group instead. */}
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
                {t("presetCustomHint")}
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * A group's answer: the situation it is set to.
 *
 * One press writes every cell of the group, so the word on the rail is true of
 * the rows under it rather than nearly true. The rows are where the reader
 * goes to disagree with it, one notification at a time, and the rail says
 * Custom while they do.
 *
 * Custom is not one of the situations. It appears only when the cells are on
 * none of them, and it opens the fold rather than picking for the reader, so
 * it stands beside the rail rather than as a fifth stop that claims to be
 * pressed.
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
  /** A write is in flight. The rail stays reachable, and does nothing. */
  saving: boolean;
  onPick: (preset: PresetSpec) => void;
  /** Open the group, for the answer that is the rows rather than a situation. */
  onCustom: () => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  const label = t("presetAriaLabel", { group });

  /** The kinds one situation sends to the device, and the ones it stops. */
  const named = (one: PresetSpec) => ({
    pushes: presetPushes(one, kinds).map((kind) => t(kind.labelKey)),
    stops: presetStops(one, kinds).map((kind) => t(kind.labelKey)),
  });

  const customId = useId();
  const chipId = useId();
  const nameId = useId();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label={label}
        className={cn(RAIL, "hidden md:inline-flex")}
      >
        {presets.map((one) => (
          <Stop
            key={one.id}
            id={one.id}
            label={t(PRESET_LABEL_KEY[one.id])}
            hint={t(one.hintKey)}
            {...named(one)}
            pressed={preset === one.id}
            saving={saving}
            onPick={() => {
              onPick(one);
            }}
          />
        ))}
      </div>
      <Tooltip delayDuration={TIP_DELAY_MS}>
        <TooltipTrigger asChild>
          <button
            type="button"
            id={chipId}
            // Named for the group it opens, so three of them on a page are
            // three different controls to a screen reader. Its own text comes
            // first, so the word on the chip is still the word in its name.
            aria-labelledby={`${chipId} ${nameId}`}
            aria-describedby={customId}
            onClick={onCustom}
            className={cn(
              STOP,
              "hidden rounded-lg border border-dashed md:inline-flex",
              // Dashed while it is an offer, solid and filled once it is the
              // state the group is in: the reader left the situations behind
              // and set the rows one by one, and the row should say so as
              // loudly as a pressed stop does.
              preset === "CUSTOM"
                ? "border-primary bg-primary/10 text-primary border-solid"
                : "border-input text-muted-foreground hover:text-foreground",
            )}
          >
            <SlidersHorizontal
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            {t(PRESET_LABEL_KEY.CUSTOM)}
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={TIP_OFFSET_PX} className={PANEL}>
          {/* No lists: it pushes and stops nothing on its own. What it does is
              open the group, and the kinds answer for themselves in there. */}
          <PresetBody
            label={t(PRESET_LABEL_KEY.CUSTOM)}
            hint={t("presetCustomHint")}
            pushes={[]}
            stops={[]}
          />
        </TooltipContent>
      </Tooltip>
      {/* The stops beside it carry their sentence this way too: a tooltip
          exists only while it is open, and this one says what pressing does. */}
      <span aria-hidden="true" id={customId} className="sr-only">
        {t("presetCustomHint")}
      </span>
      <span id={nameId} className="sr-only">
        {group}
      </span>
      <AnswerMenu
        label={label}
        presets={presets}
        preset={preset}
        group={group}
        saving={saving}
        named={named}
        onPick={onPick}
        onCustom={onCustom}
      />
    </div>
  );
}
