"use client";

import {
  Ban,
  List,
  type LucideIcon,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { CollapsibleTrigger } from "@/components/ui/collapsible";
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
  groupScopes,
  type KindSpec,
  PRESET_SCOPE_HINT_KEY,
  PRESET_SCOPE_LABEL_KEY,
  type PresetScope,
  type ScopeState,
} from "./notification-delivery";

/**
 * The rail the answers sit in.
 *
 * Square-cornered like everything it sits with: the cells are `rounded-md`
 * and the box around the whole group is `rounded-lg`, and a pill here would
 * be the one round thing in the row. The rail keeps the outer radius and its
 * stops the inner one, which differ by exactly the padding between them, so
 * the corners stay concentric instead of leaving a crescent at each end.
 *
 * It carries no display of its own. The rail and the menu below take turns by
 * width, and `hidden` loses to an `inline-flex` sitting in the same list.
 */
const RAIL = "border-input bg-background shrink-0 rounded-lg border p-0.5";

const STOP =
  "focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]";

const STOP_ON = "bg-primary/10 text-primary";
const STOP_OFF = "text-muted-foreground hover:text-foreground";

/**
 * The face of each answer.
 *
 * None of them may be a channel's icon. A bell here would read as the In app
 * column rather than as how much arrives, and the two questions are exactly
 * what this row spent a redesign separating.
 */
const ANSWER_ICON: Record<ScopeState, LucideIcon> = {
  ALL: List,
  IMPORTANT: Star,
  NONE: Ban,
  CUSTOM: SlidersHorizontal,
};

/**
 * One stop, with what it does under the pointer and in the ear.
 *
 * The tooltip is the one the channel cells carry, and for the same reason: the
 * label is a word, and the sentence that makes it a choice does not fit beside
 * it. Tooltip content exists only while it is open, so the sentence is also
 * written into the row where `aria-describedby` can always reach it.
 */
function Stop({
  answer,
  label,
  hint,
  pressed,
  saving,
  onPick,
}: {
  answer: PresetScope;
  label: string;
  hint: string;
  pressed: boolean;
  /** A write is in flight. The stop stays reachable, and does nothing. */
  saving: boolean;
  onPick: () => void;
}) {
  const hintId = useId();
  const Icon = ANSWER_ICON[answer];

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-pressed={pressed}
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
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
      <span aria-hidden="true" id={hintId} className="sr-only">
        {hint}
      </span>
    </>
  );
}

/**
 * The same answers where the rail does not fit.
 *
 * The rail wants about 500px once the words in front of it are counted, and
 * the row gets the card's width less its padding and the chevron's gutter. So
 * the two take turns at `md`. Below it the sentence is one line, and the list
 * it opens is the one place with room to say what each answer does, which the
 * rail leaves to a tooltip a phone cannot open.
 *
 * Both are in the markup and the browser draws one, the way the column heads
 * over the cells already switch.
 */
function AnswerMenu({
  label,
  answers,
  scope,
  group,
  saving,
  onPick,
}: {
  label: string;
  answers: readonly PresetScope[];
  scope: ScopeState;
  group: string;
  saving: boolean;
  onPick: (scope: PresetScope) => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  const Icon = ANSWER_ICON[scope];
  const hintId = useId();

  return (
    // No group of its own. The rail is three buttons and needs one; this is a
    // single button, and a second group with the same name would be a name
    // the reader meets twice. The sentence it would have carried is the
    // button's description instead, so the visible word stays its name.
    <div className="md:hidden">
      <span aria-hidden="true" id={hintId} className="sr-only">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={saving}
          aria-describedby={hintId}
          className={cn(
            "border-input bg-background focus-visible:ring-ring/50 inline-flex h-8 items-center gap-2 rounded-lg border pr-2 pl-3 text-xs font-medium outline-none focus-visible:ring-[3px]",
            saving && "opacity-50",
          )}
        >
          <Icon
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden="true"
          />
          {t(PRESET_SCOPE_LABEL_KEY[scope])}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {/* Custom is not one of the answers, so the radio group holds none of
              them and nothing is ticked. The heading says why rather than
              leaving the reader to wonder what they are looking at. */}
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {scope === "CUSTOM" ? t("answerMenuCustomLabel", { group }) : group}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={scope}
            onValueChange={(next) => {
              onPick(next as PresetScope);
            }}
          >
            {answers.map((answer) => {
              const AnswerIcon = ANSWER_ICON[answer];

              return (
                <DropdownMenuRadioItem
                  key={answer}
                  value={answer}
                  className="items-start py-2"
                >
                  <AnswerIcon
                    className="text-muted-foreground mt-0.5 size-3.5"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">
                      {t(PRESET_SCOPE_LABEL_KEY[answer])}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {t(PRESET_SCOPE_HINT_KEY[answer])}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {/* Not one of the answers, so it sits under them rather than in the
              radio group: it writes nothing and opens the group instead. The
              rail beside it carries the same chip at the widths it is drawn
              at. */}
          <CollapsibleTrigger asChild>
            <DropdownMenuItem className="items-start py-2">
              <SlidersHorizontal
                className="text-muted-foreground mt-0.5 size-3.5"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">
                  {t(PRESET_SCOPE_LABEL_KEY.CUSTOM)}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {t(PRESET_SCOPE_HINT_KEY.CUSTOM)}
                </span>
              </span>
            </DropdownMenuItem>
          </CollapsibleTrigger>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * A group's one answer: which of its kinds arrive.
 *
 * Where they arrive is not asked here. That is the grid's question, one kind
 * at a time, and an answer leaves it alone: a group set to the app alone stays
 * that way when the reader trims it to the kinds that matter. Two rails asked
 * both at once and read as one control with two halves, which is the thing a
 * reader has to hold in their head and should not have to.
 *
 * Custom is not one of the answers. It appears only when the kinds are on one
 * by one, and it opens the fold rather than picking for the reader. So it is
 * the fold's own trigger beside the rail, not a fourth stop that claims to be
 * pressed.
 */
export function GroupAnswer({
  group,
  kinds,
  scope,
  saving,
  onPick,
}: {
  group: string;
  kinds: readonly KindSpec[];
  scope: ScopeState;
  saving: boolean;
  onPick: (scope: PresetScope) => void;
}) {
  const t = useTranslations("App.Account.Notifications");
  const answers = groupScopes(kinds);
  const label = t("scopeAriaLabel", { group });
  const customId = useId();
  const chipId = useId();
  const nameId = useId();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs">{t("answerLead")}</span>
      <div
        role="group"
        aria-label={label}
        className={cn(RAIL, "hidden md:inline-flex")}
      >
        {answers.map((answer) => (
          <Stop
            key={answer}
            answer={answer}
            label={t(PRESET_SCOPE_LABEL_KEY[answer])}
            hint={t(PRESET_SCOPE_HINT_KEY[answer])}
            pressed={scope === answer}
            saving={saving}
            onPick={() => {
              onPick(answer);
            }}
          />
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <CollapsibleTrigger
            id={chipId}
            // Named for the group it opens, so four of them on a page are
            // four different controls to a screen reader. Its own text comes
            // first, so the word on the chip is still the word in its name.
            aria-labelledby={`${chipId} ${nameId}`}
            aria-describedby={customId}
            className={cn(
              STOP,
              "hidden rounded-lg border border-dashed md:inline-flex",
              scope === "CUSTOM"
                ? "border-primary/40 text-primary bg-primary/5"
                : "border-input text-muted-foreground hover:text-foreground",
            )}
          >
            <SlidersHorizontal
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            {t(PRESET_SCOPE_LABEL_KEY.CUSTOM)}
          </CollapsibleTrigger>
        </TooltipTrigger>
        <TooltipContent>{t(PRESET_SCOPE_HINT_KEY.CUSTOM)}</TooltipContent>
      </Tooltip>
      {/* The stops beside it carry their sentence this way too: a tooltip
          exists only while it is open, and this one says what pressing
          does. */}
      <span aria-hidden="true" id={customId} className="sr-only">
        {t(PRESET_SCOPE_HINT_KEY.CUSTOM)}
      </span>
      <span id={nameId} className="sr-only">
        {group}
      </span>
      <AnswerMenu
        label={label}
        answers={answers}
        scope={scope}
        group={group}
        saving={saving}
        onPick={onPick}
      />
    </div>
  );
}
