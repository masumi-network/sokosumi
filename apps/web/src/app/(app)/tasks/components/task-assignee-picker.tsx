"use client";

import { Check, ChevronDown, UserRound } from "lucide-react";
import { type RefObject, useId, useMemo, useRef, useState } from "react";

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

import { COMPOSER_PILL_CLASS } from "./task-composer-pill";

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
  /** The trigger's id, for a visible `<Label htmlFor>`. */
  id?: string;
  value: string;
  options: CoworkerOption[];
  labels: TaskAssigneePickerLabels;
  onSelect: (id: string) => void;
  isOptionDisabled?: (option: TaskAssigneePickerOption) => boolean;
  disabled?: boolean;
  align?: "start" | "end";
  /** `pill` is the compact trigger in the New Task property row. */
  variant?: "field" | "pill";
}

const AVATAR_CLASS = {
  trigger: "ring-border size-9 shrink-0 rounded-full ring-1",
  row: "size-6 shrink-0 rounded-full",
  compact: "size-5 shrink-0 rounded-full",
} as const;

const ORB_SIZE = { trigger: 36, row: 24, compact: 20 } as const;

export function AssigneeAvatar({
  option,
  size = "trigger",
}: {
  option: CoworkerOption | null;
  size?: keyof typeof AVATAR_CLASS;
}) {
  const avatarClass = AVATAR_CLASS[size];

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
        size={ORB_SIZE[size]}
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
          size === "trigger" ? "text-xs" : "text-2xs",
        )}
      >
        {option.name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

export function TaskAssigneePicker({
  id,
  value,
  options,
  labels,
  onSelect,
  isOptionDisabled,
  disabled = false,
  align = "start",
  variant = "field",
}: TaskAssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  const listId = useId();
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
      {variant === "pill" ? (
        <AssigneePillTrigger
          triggerRef={triggerRef}
          id={id}
          open={open}
          listId={listId}
          accessibleName={accessibleName}
          disabled={disabled}
          option={selectedOption}
          label={isUnassigned ? labels.ariaLabel : displayName}
          filled={!isUnassigned}
        />
      ) : (
        <AssigneeFieldTrigger
          triggerRef={triggerRef}
          id={id}
          open={open}
          listId={listId}
          accessibleName={accessibleName}
          disabled={disabled}
          option={selectedOption}
          displayName={displayName}
          isUnassigned={isUnassigned}
        />
      )}
      <PopoverContent
        id={listId}
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

function AssigneePillTrigger({
  triggerRef,
  id,
  open,
  listId,
  accessibleName,
  disabled,
  option,
  label,
  filled,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  id?: string;
  open: boolean;
  listId: string;
  accessibleName: string;
  disabled: boolean;
  option: CoworkerOption | null;
  label: string;
  filled: boolean;
}) {
  return (
    <PopoverTrigger asChild>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={accessibleName}
        disabled={disabled}
        data-filled={filled}
        className={COMPOSER_PILL_CLASS}
      >
        <span aria-hidden>
          <AssigneeAvatar option={option} size="compact" />
        </span>
        <span className="truncate">{label}</span>
      </button>
    </PopoverTrigger>
  );
}

function AssigneeFieldTrigger({
  triggerRef,
  id,
  open,
  listId,
  accessibleName,
  disabled,
  option,
  displayName,
  isUnassigned,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  id?: string;
  open: boolean;
  listId: string;
  accessibleName: string;
  disabled: boolean;
  option: CoworkerOption | null;
  displayName: string;
  isUnassigned: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <AssigneeAvatar option={option} />
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={accessibleName}
          disabled={disabled}
          className="focus-visible:ring-ring focus-visible:inset-ring-1 focus-visible:inset-ring-ring inline-flex min-h-6 max-w-full min-w-0 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
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
            {option?.caption ? (
              <span className="text-muted-foreground block truncate text-xs">
                {option.caption}
              </span>
            ) : null}
          </span>
          <ChevronDown
            className="text-muted-foreground size-4 shrink-0 opacity-70"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      {option ? (
        <span className="ml-auto shrink-0">
          <VendorMark
            vendor={option.vendor}
            className="h-5"
            textClassName="text-muted-foreground text-xs font-medium"
          />
        </span>
      ) : null}
    </div>
  );
}
