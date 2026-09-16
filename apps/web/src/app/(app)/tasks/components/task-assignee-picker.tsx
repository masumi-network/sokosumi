"use client";

import { Check, ChevronDown, UserRound } from "lucide-react";
import { useMemo, useState } from "react";

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

export interface TaskAssigneePickerLabels {
  ariaLabel: string;
  unassigned: string;
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

  const displayName = selectedOption?.name ?? labels.unassigned;
  const isUnassigned = value === "";

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setSearch("");
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
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0">
            <p
              className={cn(
                "truncate text-sm leading-tight font-semibold",
                isUnassigned && "text-muted-foreground",
              )}
            >
              {displayName}
            </p>
            {selectedOption?.caption ? (
              <p className="text-muted-foreground truncate text-xs">
                {selectedOption.caption}
              </p>
            ) : null}
          </div>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-label={labels.ariaLabel}
              disabled={disabled}
              className="text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
            >
              <ChevronDown className="size-4 opacity-70" aria-hidden />
            </button>
          </PopoverTrigger>
        </div>
        {selectedOption ? (
          <VendorMark
            vendor={selectedOption.vendor}
            className="ml-auto h-5 shrink-0"
            textClassName="text-muted-foreground shrink-0 text-xs font-medium"
          />
        ) : null}
      </div>
      <PopoverContent align={align} className="w-72 p-0">
        <Command>
          <CommandInput
            autoFocus
            hideIcon
            placeholder={labels.searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="p-1">
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
