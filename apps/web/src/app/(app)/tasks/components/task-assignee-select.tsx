"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";

import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { groupCoworkerAssigneeOptions } from "@/app/tasks/utils/coworker-options";
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
  personalAssistants: string;
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

function CoworkerAssigneeItem({
  option,
  selectedValue,
  nested = false,
  extraKeywords = [],
  onSelect,
}: {
  option: CoworkerOption;
  selectedValue: string;
  nested?: boolean;
  extraKeywords?: string[];
  onSelect: (value: string) => void;
}) {
  const encoded = encodeTaskAssigneeValue({
    kind: "coworker",
    id: option.id,
  });

  return (
    <CommandItem
      value={encoded}
      keywords={[
        option.name,
        option.slug,
        ...(option.caption ? [option.caption] : []),
        ...extraKeywords,
      ]}
      className={nested ? "pl-10" : undefined}
      onSelect={() => onSelect(encoded)}
    >
      <AssigneeAvatar name={option.name} image={getCoworkerImage(option)} />
      <span className="min-w-0 flex-1 truncate">{option.name}</span>
      <Check
        className={cn(
          "size-4",
          selectedValue === encoded ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
    </CommandItem>
  );
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
  personalAssistants,
  searchPlaceholder,
  emptyResults,
}: TaskAssigneeSelectProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );

  function resolvePortalContainer(): HTMLElement | null {
    const dialogContent = hostRef.current?.closest(
      "[data-slot=dialog-content]",
    );
    return dialogContent instanceof HTMLElement ? dialogContent : null;
  }

  useLayoutEffect(() => {
    setPortalContainer(resolvePortalContainer());
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
  const groupedCoworkers = useMemo(
    () =>
      groupCoworkerAssigneeOptions(
        coworkerOptions,
        memberOptions.map((member) => member.id),
      ),
    [coworkerOptions, memberOptions],
  );

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setPortalContainer(resolvePortalContainer());
    }
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
    <div ref={hostRef} className="w-full">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
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
            <ChevronsUpDown
              className="size-4 shrink-0 opacity-50"
              aria-hidden
            />
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
            <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent">
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
                    const ownedAssistants =
                      groupedCoworkers.nestedByOwnerId.get(member.id) ?? [];

                    return (
                      <Fragment key={encoded}>
                        <CommandItem
                          value={encoded}
                          keywords={
                            memberIsMe ? [me, member.name] : [member.name]
                          }
                          onSelect={() => handleSelect(encoded)}
                        >
                          <AssigneeAvatar
                            name={member.name}
                            image={member.image}
                          />
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
                        {ownedAssistants.map((option) => (
                          <CoworkerAssigneeItem
                            key={option.id}
                            option={option}
                            selectedValue={value}
                            nested
                            extraKeywords={
                              memberIsMe
                                ? [me, member.name, personalAssistants]
                                : [member.name, personalAssistants]
                            }
                            onSelect={handleSelect}
                          />
                        ))}
                      </Fragment>
                    );
                  })}
                </CommandGroup>
              ) : null}
              {groupedCoworkers.unownedPersonalAssistants.length > 0 ? (
                <CommandGroup heading={personalAssistants}>
                  {groupedCoworkers.unownedPersonalAssistants.map((option) => (
                    <CoworkerAssigneeItem
                      key={option.id}
                      option={option}
                      selectedValue={value}
                      extraKeywords={[personalAssistants]}
                      onSelect={handleSelect}
                    />
                  ))}
                </CommandGroup>
              ) : null}
              {groupedCoworkers.marketplace.length > 0 ? (
                <CommandGroup heading={coworkers}>
                  {groupedCoworkers.marketplace.map((option) => (
                    <CoworkerAssigneeItem
                      key={option.id}
                      option={option}
                      selectedValue={value}
                      onSelect={handleSelect}
                    />
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
