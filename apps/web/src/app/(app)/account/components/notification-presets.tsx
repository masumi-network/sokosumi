"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  groupScopes,
  type KindSpec,
  PRESET_PLACE_HINT_KEY,
  PRESET_PLACE_LABEL_KEY,
  PRESET_PLACES,
  PRESET_SCOPE_HINT_KEY,
  PRESET_SCOPE_LABEL_KEY,
  type PresetPlace,
  type PresetScope,
  type ScopeState,
} from "./notification-delivery";

const RAIL =
  "border-input bg-background inline-flex shrink-0 rounded-full border p-0.5";

const STOP =
  "focus-visible:ring-ring/50 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]";

const STOP_ON = "bg-primary/10 text-primary";
const STOP_OFF = "text-muted-foreground hover:text-foreground";
/** Nothing is on, so there is nothing this row can move. */
const STOP_DEAD = "text-muted-foreground/45";

/**
 * One stop, with what it does under the pointer and in the ear.
 *
 * The tooltip is the one the channel cells carry, and for the same reason: the
 * label is a word, and the sentence that makes it a choice does not fit beside
 * it. Tooltip content exists only while it is open, so the sentence is also
 * written into the row where `aria-describedby` can always reach it.
 */
function Stop({
  label,
  hint,
  pressed,
  saving,
  dead,
  onPick,
}: {
  label: string;
  hint: string;
  pressed: boolean;
  /** A write is in flight. The stop stays reachable, and does nothing. */
  saving: boolean;
  /** Nothing to write. Same rule, different reason, so it reads differently. */
  dead: boolean;
  onPick: () => void;
}) {
  const hintId = useId();

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-pressed={pressed}
            aria-disabled={saving || dead || undefined}
            aria-describedby={hintId}
            onClick={() => {
              if (saving || dead) {
                return;
              }

              onPick();
            }}
            className={cn(
              STOP,
              saving && "opacity-50",
              pressed ? STOP_ON : dead ? STOP_DEAD : STOP_OFF,
            )}
          >
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
      <span aria-hidden="true" id={hintId} className="sr-only">
        {hint}
      </span>
    </>
  );
}

/**
 * A group's two answers, one question to a row.
 *
 * The first row says which of the group's kinds arrive: all of them, the ones
 * that matter, or none. The second says where the ones it keeps arrive. Two
 * questions rather than one ladder, because they were never one scale. The
 * old stops stepped from Everything to Important by dropping kinds and from
 * Important to Quiet by dropping a channel, so neither stop told the reader
 * what the next one would do. It also left one wish unsayable: every kind,
 * without a banner, which no stop wrote and six cells by hand did.
 *
 * Custom is not one of the answers. It appears on the first row only when the
 * kinds are on one by one, and it opens the fold rather than picking for the
 * reader. So it is the fold's own trigger, not a fourth stop that claims to be
 * pressed.
 */
export function PresetStops({
  group,
  kinds,
  scope,
  place,
  saving,
  onScope,
  onPlace,
}: {
  group: string;
  kinds: readonly KindSpec[];
  scope: ScopeState;
  /** Null when the kinds that are on do not share a place, or none are on. */
  place: PresetPlace | null;
  saving: boolean;
  onScope: (scope: PresetScope) => void;
  onPlace: (place: PresetPlace) => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  // Nothing is on, so this row has nothing to move. It still stands rather
  // than appearing on the first press, which would shift every row under it.
  const nowhere = scope === "NONE";

  return (
    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
      <div
        role="group"
        aria-label={t("scopeAriaLabel", { group })}
        className={RAIL}
      >
        {groupScopes(kinds).map((candidate) => (
          <Stop
            key={candidate}
            label={t(PRESET_SCOPE_LABEL_KEY[candidate])}
            hint={t(PRESET_SCOPE_HINT_KEY[candidate])}
            pressed={scope === candidate}
            saving={saving}
            dead={false}
            onPick={() => {
              onScope(candidate);
            }}
          />
        ))}
        {scope === "CUSTOM" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <CollapsibleTrigger
                className={cn(
                  STOP,
                  "text-primary bg-primary/5 border border-dashed",
                )}
              >
                {t(PRESET_SCOPE_LABEL_KEY.CUSTOM)}
              </CollapsibleTrigger>
            </TooltipTrigger>
            <TooltipContent>{t(PRESET_SCOPE_HINT_KEY.CUSTOM)}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div
        role="group"
        aria-label={t("placeAriaLabel", { group })}
        className={RAIL}
      >
        {PRESET_PLACES.map((candidate) => (
          <Stop
            key={candidate}
            label={t(PRESET_PLACE_LABEL_KEY[candidate])}
            hint={t(
              nowhere ? "placeNowhereHint" : PRESET_PLACE_HINT_KEY[candidate],
            )}
            pressed={place === candidate}
            saving={saving}
            dead={nowhere}
            onPick={() => {
              onPlace(candidate);
            }}
          />
        ))}
      </div>
    </div>
  );
}
