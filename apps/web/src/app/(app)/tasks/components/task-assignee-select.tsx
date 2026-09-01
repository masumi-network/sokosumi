"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import {
  decodeTaskAssigneeValue,
  encodeTaskAssigneeValue,
  type TaskAssigneeMemberOption,
  UNSET_TASK_ASSIGNEE_VALUE,
} from "@/app/tasks/utils/task-assignee";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

export interface TaskAssigneeSelectLabels {
  assignee: string;
  unassigned: string;
  me: string;
  people: string;
  coworkers: string;
  searchPlaceholder: string;
  emptyResults: string;
}

interface TaskAssigneeSelectProps extends TaskAssigneeSelectLabels {
  coworkerOptions: CoworkerOption[];
  memberOptions: TaskAssigneeMemberOption[];
  currentUserId?: string | null;
  value: string;
  onChange: (value: string) => void;
}

function AssigneeAvatar({
  name,
  image,
}: {
  name: string;
  image?: string | null;
}) {
  return (
    <Avatar className="size-5 shrink-0">
      {image ? (
        <AvatarImage src={image} alt={name} className="object-cover" />
      ) : null}
      <AvatarFallback className="bg-muted text-[0.625rem] font-medium">
        {name.slice(0, 1).toUpperCase() || "?"}
      </AvatarFallback>
    </Avatar>
  );
}

function isCurrentUser(
  memberId: string,
  currentUserId: string | null | undefined,
): boolean {
  return Boolean(currentUserId) && memberId === currentUserId;
}

export function TaskAssigneeSelect({
  coworkerOptions,
  memberOptions,
  currentUserId = null,
  value,
  onChange,
  assignee,
  unassigned,
  me,
  people,
  coworkers,
  searchPlaceholder,
  emptyResults,
}: TaskAssigneeSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );

  useLayoutEffect(() => {
    const dialogContent = triggerRef.current?.closest(
      "[data-slot=dialog-content]",
    );
    setPortalContainer(
      dialogContent instanceof HTMLElement ? dialogContent : null,
    );
  }, []);
  const selection = decodeTaskAssigneeValue(value);
  const selectedCoworker = useMemo(
    () =>
      selection.kind === "coworker"
        ? (coworkerOptions.find((option) => option.id === selection.id) ?? null)
        : null,
    [coworkerOptions, selection],
  );
  const selectedMember = useMemo(
    () =>
      selection.kind === "user"
        ? (memberOptions.find((option) => option.id === selection.id) ?? null)
        : null,
    [memberOptions, selection],
  );
  const selectedLabel =
    selectedCoworker?.name ??
    (selectedMember
      ? isCurrentUser(selectedMember.id, currentUserId)
        ? me
        : selectedMember.name
      : unassigned);
  const selectedImage =
    selectedCoworker != null
      ? getCoworkerImage(selectedCoworker)
      : (selectedMember?.image ?? null);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch("");
    }
  }

  function handleSelect(nextValue: string) {
    onChange(nextValue);
    handleOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={assignee}
          className="w-full justify-between gap-2"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {selection.kind === "unset" ? null : (
              <AssigneeAvatar name={selectedLabel} image={selectedImage} />
            )}
            <span
              className={cn(
                "truncate",
                selection.kind === "unset"
                  ? "text-muted-foreground"
                  : "text-foreground",
              )}
            >
              {selectedLabel}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        container={portalContainer}
        className="flex w-(--radix-popover-trigger-width) max-h-(--radix-popover-content-available-height) flex-col overflow-hidden p-0"
      >
        <Command
          className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
          shouldFilter
        >
          <CommandInput
            autoFocus
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y">
            <CommandEmpty>{emptyResults}</CommandEmpty>
            <CommandItem
              value={UNSET_TASK_ASSIGNEE_VALUE}
              keywords={[unassigned]}
              onSelect={() => handleSelect(UNSET_TASK_ASSIGNEE_VALUE)}
            >
              <span className="flex-1 truncate">{unassigned}</span>
              <Check
                className={cn(
                  "size-4",
                  selection.kind === "unset" ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
            </CommandItem>
            {memberOptions.length > 0 ? (
              <CommandGroup heading={people}>
                {memberOptions.map((member) => {
                  const encoded = encodeTaskAssigneeValue({
                    kind: "user",
                    id: member.id,
                  });
                  const memberIsMe = isCurrentUser(member.id, currentUserId);

                  return (
                    <CommandItem
                      key={encoded}
                      value={encoded}
                      keywords={memberIsMe ? [me, member.name] : [member.name]}
                      onSelect={() => handleSelect(encoded)}
                    >
                      <AssigneeAvatar name={member.name} image={member.image} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">
                          {memberIsMe ? me : member.name}
                        </span>
                        {memberIsMe ? (
                          <span className="text-muted-foreground truncate text-xs">
                            {member.name}
                          </span>
                        ) : null}
                      </span>
                      <Check
                        className={cn(
                          "size-4",
                          value === encoded ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {coworkerOptions.length > 0 ? (
              <CommandGroup heading={coworkers}>
                {coworkerOptions.map((option) => {
                  const encoded = encodeTaskAssigneeValue({
                    kind: "coworker",
                    id: option.id,
                  });

                  return (
                    <CommandItem
                      key={encoded}
                      value={encoded}
                      keywords={[option.name, option.slug]}
                      onSelect={() => handleSelect(encoded)}
                    >
                      <AssigneeAvatar
                        name={option.name}
                        image={getCoworkerImage(option)}
                      />
                      <span className="flex-1 truncate">{option.name}</span>
                      <Check
                        className={cn(
                          "size-4",
                          value === encoded ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
