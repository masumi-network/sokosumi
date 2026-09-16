"use client";

import { Check, ChevronDown, UserRound } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { VendorMark } from "@/components/agents/vendor-mark";
import { AssistantOrb } from "@/components/aurora-orb";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";

const UNASSIGNED_VALUE = "__unassigned__";
const DIALOG_CONTENT_SELECTOR = '[data-slot="dialog-content"]';

export interface TaskAssigneePickerLabels {
  ariaLabel: string;
  unassigned: string;
  /** Shown when `value` is set but missing from `options`. */
  unavailableAssignee: string;
  searchPlaceholder: string;
  noResults: string;
  membersGroupLabel?: string;
  agentsGroupLabel: string;
}

export type TaskAssigneePickerOption = CoworkerOption | "unassigned";

interface TaskAssigneePickerProps {
  value: string;
  options: CoworkerOption[];
  labels: TaskAssigneePickerLabels;
  onSelect: (id: string) => void;
  isOptionDisabled?: (option: TaskAssigneePickerOption) => boolean;
  disabled?: boolean;
  align?: "start" | "end";
}

function AssigneeAvatar({
  option,
  size = "trigger",
}: {
  option: CoworkerOption | null;
  size?: "trigger" | "row";
}) {
  const avatarClass =
    size === "trigger"
      ? "ring-border size-9 shrink-0 rounded-full ring-1"
      : "size-6 shrink-0 rounded-full";

  if (!option) {
    return (
      <Avatar className={avatarClass}>
        <AvatarFallback className="rounded-full">
          <UserRound
            className={cn(
              "text-muted-foreground",
              size === "trigger" ? "size-4" : "size-3.5",
            )}
            aria-hidden
          />
        </AvatarFallback>
      </Avatar>
    );
  }

  if (option.kind === "sokoBot" && !option.image && option.avatarSeed) {
    return (
      <AssistantOrb
        seed={option.avatarSeed}
        expression="idle"
        animate={false}
        size={size === "trigger" ? 36 : 24}
        className={avatarClass}
        alt={option.name}
      />
    );
  }

  return (
    <Avatar className={avatarClass}>
      <AvatarImage
        src={option.image}
        alt={option.name}
        className="object-cover"
      />
      <AvatarFallback
        className={cn(
          "rounded-full font-medium",
          size === "trigger" ? "text-xs" : "text-[0.625rem]",
        )}
      >
        {option.name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

export function TaskAssigneePicker({
  value,
  options,
  labels,
  onSelect,
  isOptionDisabled,
  disabled = false,
  align = "start",
}: TaskAssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedOption = useMemo(() => {
    if (!value) return null;
    return options.find((option) => option.id === value) ?? null;
  }, [options, value]);

  const memberOptions = useMemo(
    () => options.filter((option) => option.kind === "user"),
    [options],
  );
  const agentOptions = useMemo(
    () => options.filter((option) => option.kind !== "user"),
    [options],
  );

  const membersGroupLabel =
    labels.membersGroupLabel ?? memberOptions[0]?.vendor.name;

  const isUnassigned = value === "";
  const displayName =
    selectedOption?.name ??
    (isUnassigned ? labels.unassigned : labels.unavailableAssignee);
  const accessibleName = `${labels.ariaLabel}: ${displayName}`;

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch("");
      setPortalContainer(undefined);
      return;
    }
    // Body-portaled lists sit outside the dialog scroll-lock allowlist, so
    // wheel/touch scroll dies. Portal into the dialog when one owns the trigger.
    const dialog = triggerRef.current?.closest(DIALOG_CONTENT_SELECTOR);
    setPortalContainer(dialog instanceof HTMLElement ? dialog : undefined);
  }

  function handleSelect(nextValue: string) {
    handleOpenChange(false);
    const nextId = nextValue === UNASSIGNED_VALUE ? "" : nextValue;
    if (nextId !== value) onSelect(nextId);
  }

  function renderOption(option: CoworkerOption) {
    const isCurrent = option.id === value;
    const isDisabled = isOptionDisabled?.(option) ?? false;

    return (
      <CommandItem
        key={option.id}
        value={option.id}
        keywords={[option.name, option.caption ?? "", option.vendor.name]}
        disabled={isDisabled}
        data-current={isCurrent || undefined}
        onSelect={() => handleSelect(option.id)}
      >
        <span aria-hidden>
          <AssigneeAvatar option={option} size="row" />
        </span>
        <span className="flex-1 truncate">{option.name}</span>
        {isCurrent ? <Check className="size-4" aria-hidden /> : null}
      </CommandItem>
    );
  }

  const unassignedDisabled = isOptionDisabled?.("unassigned") ?? false;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div className="flex items-center gap-3">
        <AssigneeAvatar option={selectedOption} />
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-label={accessibleName}
            disabled={disabled}
            className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
          >
            <span className="min-w-0">
              <span
                className={cn(
                  "block truncate text-sm leading-tight font-semibold",
                  isUnassigned && "text-muted-foreground",
                )}
              >
                {displayName}
              </span>
              {selectedOption?.caption ? (
                <span className="text-muted-foreground block truncate text-xs">
                  {selectedOption.caption}
                </span>
              ) : null}
            </span>
            <ChevronDown
              className="text-muted-foreground size-4 shrink-0 opacity-70"
              aria-hidden
            />
          </button>
        </PopoverTrigger>
        {selectedOption ? (
          <span className="ml-auto shrink-0">
            <VendorMark
              vendor={selectedOption.vendor}
              className="h-5"
              textClassName="text-muted-foreground text-xs font-medium"
            />
          </span>
        ) : null}
      </div>
      <PopoverContent
        align={align}
        container={portalContainer}
        className="w-72 p-0"
      >
        <Command>
          <CommandInput
            autoFocus
            hideIcon
            placeholder={labels.searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="touch-pan-y p-1">
            <CommandEmpty>{labels.noResults}</CommandEmpty>
            <CommandItem
              value={UNASSIGNED_VALUE}
              keywords={[labels.unassigned]}
              disabled={unassignedDisabled}
              data-current={isUnassigned || undefined}
              onSelect={() => handleSelect(UNASSIGNED_VALUE)}
            >
              <span aria-hidden>
                <AssigneeAvatar option={null} size="row" />
              </span>
              <span className="flex-1 truncate">{labels.unassigned}</span>
              {isUnassigned ? <Check className="size-4" aria-hidden /> : null}
            </CommandItem>
            {memberOptions.length > 0 && membersGroupLabel ? (
              <CommandGroup heading={membersGroupLabel}>
                {memberOptions.map(renderOption)}
              </CommandGroup>
            ) : null}
            {agentOptions.length > 0 ? (
              <CommandGroup heading={labels.agentsGroupLabel}>
                {agentOptions.map(renderOption)}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
