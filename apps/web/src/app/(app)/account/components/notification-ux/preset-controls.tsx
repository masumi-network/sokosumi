"use client";

import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  type CategoryGroup,
  PRESET_COPY,
  PRESET_IDS,
  type PresetId,
} from "./notification-model";
import { type NotificationChoices } from "./use-notification-choices";

const CUSTOM_STOP =
  "text-primary bg-primary/5 rounded-full border border-dashed px-3 py-1 text-xs font-medium whitespace-nowrap";

/**
 * What a preset means for this group, in that group's own words.
 *
 * "Everything" is a different promise for chat than for jobs, and a preset that
 * cannot say which one it is has to be taken on trust.
 */
function presetHint(
  group: CategoryGroup,
  choices: NotificationChoices,
  preset: PresetId,
) {
  const rung =
    preset === "EVERYTHING"
      ? group.rungs.at(-1)
      : preset === "IMPORTANT"
        ? group.rungs[group.defaultScope]
        : group.rungs[choices.groupScope(group)];

  if (preset === "OFF") {
    return PRESET_COPY.OFF.hint;
  }

  const where = preset === "QUIET" ? ", in Sokosumi only" : "";

  return `${rung?.summary ?? group.description}${where}`;
}

/** The presets as stops on the row. The control D1 grew into. */
export function PresetSegments({
  group,
  choices,
  onCustom,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
  onCustom?: () => void;
}) {
  const active = choices.groupPreset(group);

  return (
    <div
      role="group"
      aria-label={`${group.label} preset`}
      className="border-input bg-background inline-flex rounded-full border p-0.5"
    >
      {choices.groupPresets(group).map((preset) => (
        <button
          key={preset}
          type="button"
          aria-pressed={active === preset}
          title={presetHint(group, choices, preset)}
          onClick={() => {
            void choices.setGroupPreset(group, preset);
          }}
          className={cn(
            "focus-visible:ring-ring/50 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]",
            active === preset
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {PRESET_COPY[preset].label}
        </button>
      ))}
      {active === "CUSTOM" ? (
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
            {PRESET_COPY.CUSTOM.label}
          </button>
        ) : (
          <span className={CUSTOM_STOP}>{PRESET_COPY.CUSTOM.label}</span>
        )
      ) : null}
    </div>
  );
}

/** The same presets as chips that wrap. For a narrow row. */
export function PresetChips({
  group,
  choices,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
}) {
  const active = choices.groupPreset(group);

  return (
    <div
      role="group"
      aria-label={`${group.label} preset`}
      className="flex flex-wrap items-center gap-2"
    >
      {choices.groupPresets(group).map((preset) => (
        <button
          key={preset}
          type="button"
          aria-pressed={active === preset}
          onClick={() => {
            void choices.setGroupPreset(group, preset);
          }}
          className={cn(
            "focus-visible:ring-ring/50 h-8 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]",
            active === preset
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {PRESET_COPY[preset].label}
        </button>
      ))}
      {active === "CUSTOM" ? (
        <span className={cn(CUSTOM_STOP, "inline-flex h-8 items-center")}>
          {PRESET_COPY.CUSTOM.label}
        </span>
      ) : null}
    </div>
  );
}

/** The presets behind one word, with the way into the two ladders under them. */
export function PresetMenu({
  group,
  choices,
  onCustom,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
  onCustom: () => void;
}) {
  const active = choices.groupPreset(group);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${group.label} preset`}
        className="border-input hover:bg-accent focus-visible:ring-ring/50 data-[state=open]:bg-accent inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-[3px]"
      >
        {PRESET_COPY[active].label}
        <ChevronDown className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuRadioGroup
          value={active}
          onValueChange={(next) => {
            void choices.setGroupPreset(group, next as PresetId);
          }}
        >
          {choices.groupPresets(group).map((preset) => (
            <DropdownMenuRadioItem key={preset} value={preset}>
              <span className="min-w-0">
                <span className="block text-sm leading-5">
                  {PRESET_COPY[preset].label}
                </span>
                <span className="text-muted-foreground block text-xs leading-5">
                  {presetHint(group, choices, preset)}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCustom}>
          <SlidersHorizontal />
          Choose what and where
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The presets as rows, each saying what it means here. For an open panel. */
export function PresetList({
  group,
  choices,
  onPicked,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
  onPicked?: () => void;
}) {
  const active = choices.groupPreset(group);

  return (
    <div
      role="radiogroup"
      aria-label={`${group.label} preset`}
      className="grid gap-1"
    >
      {choices.groupPresets(group).map((preset) => (
        <button
          key={preset}
          type="button"
          role="radio"
          aria-checked={active === preset}
          onClick={() => {
            void choices.setGroupPreset(group, preset);
            onPicked?.();
          }}
          className={cn(
            "hover:bg-accent focus-visible:ring-ring/50 flex items-start gap-3 rounded-md p-2 text-left outline-none focus-visible:ring-[3px]",
            active === preset && "bg-accent/60",
          )}
        >
          <Check
            className={cn(
              "text-primary mt-0.5 size-4 shrink-0",
              active !== preset && "opacity-0",
            )}
          />
          <span className="min-w-0">
            <span className="block text-sm leading-5 font-medium">
              {PRESET_COPY[preset].label}
            </span>
            <span className="text-muted-foreground block text-sm leading-6">
              {presetHint(group, choices, preset)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * One answer for every group.
 *
 * The same four words as a group preset, which is the point: a reader who wants
 * the same thing everywhere presses once, and the groups below become
 * exceptions to it rather than four separate decisions.
 */
export function PagePresets({ choices }: { choices: NotificationChoices }) {
  const active = choices.pagePreset();

  return (
    <div
      role="group"
      aria-label="All notifications"
      className="border-input bg-background inline-flex shrink-0 rounded-full border p-0.5"
    >
      {PRESET_IDS.map((preset) => (
        <button
          key={preset}
          type="button"
          aria-pressed={active === preset}
          onClick={() => {
            void choices.setPagePreset(preset);
          }}
          className={cn(
            "focus-visible:ring-ring/50 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]",
            active === preset
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {PRESET_COPY[preset].label}
        </button>
      ))}
    </div>
  );
}
