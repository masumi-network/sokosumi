"use client";

import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getToneStyle,
  MARKER_ICONS,
  StatusMarker,
} from "@/components/ui/status-marker";
import type { TaskStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";
import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";

import { getTaskStatusMarker } from "./task-status-badge";

export interface TaskStatusPickerLabels {
  statusLabels: Record<TaskStatus, string>;
  ariaLabel: string;
  searchPlaceholder: string;
  noResults: string;
}

interface TaskStatusPickerProps {
  value: TaskStatus;
  /** Statuses the actor may move to; the current one is added by the picker. */
  options: readonly TaskStatus[];
  labels: TaskStatusPickerLabels;
  onSelect: (status: TaskStatus) => void;
  /** Form-state gates that Core cannot know about yet (assignee or schedule being edited). */
  isOptionDisabled?: (status: TaskStatus) => boolean;
  isPending?: boolean;
  disabled?: boolean;
  /** Single letter that opens the picker from anywhere on the page, like Linear's S. */
  openShortcutKey?: string;
  align?: "start" | "end";
}

const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export function TaskStatusPicker({
  value,
  options,
  labels,
  onSelect,
  isOptionDisabled,
  isPending = false,
  disabled = false,
  openShortcutKey,
  align = "end",
}: TaskStatusPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const offered = new Set<TaskStatus>([value, ...options]);
    let nextDigit = 0;
    return TASK_STATUS_DISPLAY_ORDER.filter((status) =>
      offered.has(status),
    ).map((status) => {
      const isDisabled = isOptionDisabled?.(status) ?? false;
      const digit =
        !isDisabled && nextDigit < DIGIT_KEYS.length
          ? DIGIT_KEYS[nextDigit++]
          : null;
      return { status, isDisabled, digit };
    });
  }, [value, options, isOptionDisabled]);

  useEffect(() => {
    if (!openShortcutKey || disabled || isPending) return;

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() !== openShortcutKey) return;
      if (isEditableKeyboardTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openShortcutKey, disabled, isPending]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setSearch("");
  }

  function handleSelect(status: TaskStatus) {
    handleOpenChange(false);
    if (status !== value) onSelect(status);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Digits address the full list; once a filter hides rows they are typed.
    if (search || event.metaKey || event.ctrlKey || event.altKey) return;
    const row = rows.find((candidate) => candidate.digit === event.key);
    if (!row) return;
    event.preventDefault();
    handleSelect(row.status);
  }

  const marker = getTaskStatusMarker(value);
  const style = getToneStyle(marker.tone);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={labels.ariaLabel}
          disabled={disabled || isPending}
          className="focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring rounded-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium",
              style.box,
              style.label,
            )}
          >
            <StatusMarker
              spec={
                isPending
                  ? {
                      tone: marker.tone,
                      icon: MARKER_ICONS.running,
                      spin: true,
                    }
                  : marker
              }
            />
            <span>{labels.statusLabels[value]}</span>
            <ChevronDown className="size-3 opacity-70" aria-hidden />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <Command onKeyDown={handleListKeyDown}>
          <div className="relative">
            <CommandInput
              autoFocus
              hideIcon
              placeholder={labels.searchPlaceholder}
              value={search}
              onValueChange={setSearch}
            />
            {openShortcutKey ? (
              <kbd
                aria-hidden
                className="text-muted-foreground bg-muted pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-sm border px-1.5 py-0.5 font-sans text-xs uppercase"
              >
                {openShortcutKey}
              </kbd>
            ) : null}
          </div>
          {/* p-1 + item px-2 puts row icons on the input text's left edge. */}
          <CommandList className="p-1">
            <CommandEmpty>{labels.noResults}</CommandEmpty>
            {rows.map(({ status, isDisabled, digit }) => {
              const rowMarker = getTaskStatusMarker(status);
              const isCurrent = status === value;
              return (
                <CommandItem
                  key={status}
                  value={status}
                  keywords={[labels.statusLabels[status]]}
                  disabled={isDisabled}
                  data-current={isCurrent || undefined}
                  onSelect={() => handleSelect(status)}
                >
                  <StatusMarker
                    spec={rowMarker}
                    // A menu row paints no fill, so the glyph sits on the
                    // popover surface and takes the on-card colour. `mark` is
                    // the colour of a mark on the tone's own box, which for
                    // the solid fault tone is near-white: invisible here.
                    tone={getToneStyle(rowMarker.tone).onSurface}
                    // A status you could pick, not one that is running.
                    live={false}
                  />
                  <span className="flex-1 truncate">
                    {labels.statusLabels[status]}
                  </span>
                  {isCurrent ? <Check className="size-4" aria-hidden /> : null}
                  {digit ? <CommandShortcut>{digit}</CommandShortcut> : null}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
