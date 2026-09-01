"use client";

import { Check } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  type CategoryGroup,
  GROUP_LEVELS,
  type GroupLevel,
  LEVEL_COPY,
} from "./notification-model";
import { type NotificationChoices } from "./use-notification-choices";

const CUSTOM_STOP =
  "text-primary bg-primary/5 rounded-full border border-dashed px-3 py-1 text-xs font-medium whitespace-nowrap";

/**
 * Where a group's events arrive: everything, in Sokosumi only, or nowhere.
 *
 * A fourth stop appears only while the group is custom. Offering "Custom" as
 * something to pick would be a lie: it writes nothing. Showing it while it is
 * true tells the reader why no stop is lit, and clicking it opens the group,
 * which is where custom is actually made.
 */
export function LevelSegments({
  group,
  choices,
  onCustom,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
  /** Left out where the group is already open, so the stop is a label instead. */
  onCustom?: () => void;
}) {
  const active = choices.groupLevel(group);

  return (
    <div
      role="group"
      aria-label={`${group.label}, where it arrives`}
      className="border-input bg-background inline-flex rounded-full border p-0.5"
    >
      {GROUP_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={active === level}
          onClick={() => {
            void choices.setGroupLevel(group, level);
          }}
          className={cn(
            "focus-visible:ring-ring/50 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]",
            active === level
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LEVEL_COPY[level].short}
        </button>
      ))}
      {active === "CUSTOM" ? (
        // A button only where pressing it has somewhere to go. In a group that
        // is already open it is a label, and a label is not something to press.
        onCustom ? (
          <button
            type="button"
            aria-pressed
            onClick={onCustom}
            className={cn(
              CUSTOM_STOP,
              "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
            )}
          >
            {LEVEL_COPY.CUSTOM.short}
          </button>
        ) : (
          <span className={CUSTOM_STOP}>{LEVEL_COPY.CUSTOM.short}</span>
        )
      ) : null}
    </div>
  );
}

/** The same three answers in the width of one word. */
export function LevelSelect({
  group,
  choices,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
}) {
  const active = choices.groupLevel(group);

  return (
    <Select
      value={active}
      onValueChange={(next) => {
        void choices.setGroupLevel(group, next as GroupLevel);
      }}
    >
      <SelectTrigger size="sm" aria-label={`${group.label}, where it arrives`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {GROUP_LEVELS.map((level) => (
          <SelectItem key={level} value={level}>
            {LEVEL_COPY[level].label}
          </SelectItem>
        ))}
        {/* Present only so the trigger can show the state it is in. Picking it
            would write nothing, so it cannot be picked. */}
        {active === "CUSTOM" ? (
          <SelectItem value="CUSTOM" disabled>
            {LEVEL_COPY.CUSTOM.label}
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  );
}

/** The three answers spelled out, one under the other. For an open panel. */
export function LevelList({
  group,
  choices,
  onPicked,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
  onPicked?: () => void;
}) {
  const active = choices.groupLevel(group);

  return (
    <div
      role="radiogroup"
      aria-label={`${group.label}, where it arrives`}
      className="grid gap-1"
    >
      {GROUP_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={active === level}
          onClick={() => {
            void choices.setGroupLevel(group, level);
            onPicked?.();
          }}
          className={cn(
            "hover:bg-accent focus-visible:ring-ring/50 flex items-center gap-3 rounded-md p-2 text-left outline-none focus-visible:ring-[3px]",
            active === level && "bg-accent/60",
          )}
        >
          <Check
            className={cn(
              "text-primary size-4 shrink-0",
              active !== level && "opacity-0",
            )}
          />
          <span className="min-w-0 text-sm leading-5 font-medium">
            {LEVEL_COPY[level].label}
          </span>
        </button>
      ))}
    </div>
  );
}
