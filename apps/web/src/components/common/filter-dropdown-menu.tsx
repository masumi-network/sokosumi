"use client";

import { Check, ListFilter, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface FilterDropdownMenuOption {
  value: string;
  label: string;
  avatarLabel?: string;
  image?: string | null;
  searchKeywords?: string[];
}

export interface FilterDropdownMenuSection {
  id: string;
  label: string;
  icon: LucideIcon;
  value: string | null;
  options: FilterDropdownMenuOption[];
  allLabel?: string;
  onChange: (value: string | null) => void;
}

interface FilterDropdownMenuProps {
  buttonLabel: string;
  searchPlaceholder: string;
  emptyResultsLabel: string;
  sections: FilterDropdownMenuSection[];
}

const ALL_FILTER_VALUE = "__all__";

export function FilterDropdownMenu({
  buttonLabel,
  searchPlaceholder,
  emptyResultsLabel,
  sections,
}: FilterDropdownMenuProps) {
  const [open, setOpen] = useState(false);

  if (sections.length === 0) {
    return null;
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <ListFilter className="size-4" aria-hidden />
          <span className="hidden sm:inline">{buttonLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {sections.map((section) => (
          <FilterDropdownMenuSectionItem
            key={section.id}
            section={section}
            searchPlaceholder={searchPlaceholder}
            emptyResultsLabel={emptyResultsLabel}
            onSelect={() => setOpen(false)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface FilterDropdownMenuSectionItemProps {
  section: FilterDropdownMenuSection;
  searchPlaceholder: string;
  emptyResultsLabel: string;
  onSelect: () => void;
}

function FilterDropdownMenuSectionItem({
  section,
  searchPlaceholder,
  emptyResultsLabel,
  onSelect,
}: FilterDropdownMenuSectionItemProps) {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const selectedOption = useMemo(
    () =>
      section.options.find((option) => option.value === section.value) ?? null,
    [section.options, section.value],
  );
  const optionItems = useMemo(() => {
    if (!section.allLabel) {
      return section.options;
    }

    return [
      {
        value: ALL_FILTER_VALUE,
        label: section.allLabel,
      },
      ...section.options,
    ];
  }, [section.allLabel, section.options]);

  return (
    <DropdownMenuSub
      open={submenuOpen}
      onOpenChange={(nextOpen) => setSubmenuOpen(nextOpen)}
    >
      <DropdownMenuSubTrigger className="gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <section.icon
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            <span className="truncate">{section.label}</span>
          </div>
          <span className="max-w-28 truncate text-right text-xs text-muted-foreground">
            {selectedOption?.label ?? section.allLabel}
          </span>
        </div>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72 p-0">
        <Command className="**:data-[slot=command-list]:max-h-72" shouldFilter>
          <CommandInput autoFocus placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyResultsLabel}</CommandEmpty>
            {optionItems.map((option) => {
              const isAllOption = option.value === ALL_FILTER_VALUE;
              const isSelected = isAllOption
                ? section.value === null
                : option.value === section.value;
              const filterKeywords = [
                option.label,
                ...(option.searchKeywords ?? []),
              ];

              return (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={filterKeywords}
                  onSelect={() => {
                    section.onChange(isAllOption ? null : option.value);
                    onSelect();
                  }}
                >
                  <FilterDropdownMenuOptionAvatar option={option} />
                  <span className="flex-1 truncate">{option.label}</span>
                  <Check
                    className={cn(
                      "size-4",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function FilterDropdownMenuOptionAvatar({
  option,
}: {
  option: Pick<FilterDropdownMenuOption, "avatarLabel" | "image">;
}) {
  if (!option.avatarLabel) {
    return null;
  }

  const fallback = option.avatarLabel.trim().charAt(0).toUpperCase() || "?";

  return (
    <Avatar className="size-5 shrink-0">
      {option.image ? (
        <AvatarImage src={option.image} alt={option.avatarLabel} />
      ) : null}
      <AvatarFallback className="bg-muted text-[10px] font-medium">
        {fallback}
      </AvatarFallback>
    </Avatar>
  );
}
