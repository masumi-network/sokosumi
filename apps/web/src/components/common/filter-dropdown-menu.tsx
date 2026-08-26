"use client";

import { Check, ListFilter, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import AgentIcon from "@/components/agents/agent-icon";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface FilterDropdownMenuOption {
  value: string;
  label: string;
  avatarLabel?: string;
  image?: string | null;
  useAgentIcon?: boolean;
  searchKeywords?: string[];
}

export interface FilterDropdownMenuSectionPagination {
  nextCursor: string | null;
  onLoadMore: () => void;
  isLoadingMore?: boolean;
  loadMoreLabel: string;
}

export interface FilterDropdownMenuSection {
  id: string;
  label: string;
  icon: LucideIcon;
  value: string | null;
  options: FilterDropdownMenuOption[];
  allLabel?: string;
  onChange: (value: string | null) => void;
  pagination?: FilterDropdownMenuSectionPagination;
}

interface FilterDropdownMenuProps {
  buttonLabel: string;
  searchPlaceholder: string;
  emptyResultsLabel: string;
  sections: FilterDropdownMenuSection[];
  showActiveIndicator?: boolean;
}

const ALL_FILTER_VALUE = "__all__";

export function FilterDropdownMenu({
  buttonLabel,
  searchPlaceholder,
  emptyResultsLabel,
  sections,
  showActiveIndicator = false,
}: FilterDropdownMenuProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  if (sections.length === 0) {
    return null;
  }

  const handleClose = () => {
    setDropdownOpen(false);
    setSheetOpen(false);
    setExpandedSection(null);
  };

  return (
    <>
      {/* Desktop dropdown - hidden on mobile */}
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger asChild className="hidden sm:flex">
          <Button variant="outline" size="sm" className="relative gap-2">
            <ListFilter className="size-4" aria-hidden />
            <span>{buttonLabel}</span>
            {showActiveIndicator ? (
              <span
                aria-hidden
                className="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background"
              />
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {sections.map((section) => (
            <FilterDropdownMenuSectionItem
              key={section.id}
              section={section}
              searchPlaceholder={searchPlaceholder}
              emptyResultsLabel={emptyResultsLabel}
              onSelect={handleClose}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mobile sheet - visible only on mobile */}
      <Button
        variant="outline"
        size="sm"
        className="relative gap-2 sm:hidden"
        onClick={() => setSheetOpen(true)}
      >
        <ListFilter className="size-4" aria-hidden />
        {showActiveIndicator ? (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background"
          />
        ) : null}
      </Button>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="h-[80vh]">
          <SheetHeader>
            <SheetTitle>{buttonLabel}</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(80vh-5rem)] pr-4">
            <div className="mt-4 space-y-4">
              {sections.map((section) => (
                <FilterDropdownMenuSectionMobile
                  key={section.id}
                  section={section}
                  searchPlaceholder={searchPlaceholder}
                  emptyResultsLabel={emptyResultsLabel}
                  expanded={expandedSection === section.id}
                  onToggle={() =>
                    setExpandedSection(
                      expandedSection === section.id ? null : section.id,
                    )
                  }
                  onSelect={handleClose}
                />
              ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
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
            {section.pagination?.nextCursor ? (
              <CommandItem
                key={`${section.id}-load-more`}
                value={`${section.id}-load-more`}
                forceMount
                onSelect={() => {
                  section.pagination?.onLoadMore();
                }}
                disabled={section.pagination.isLoadingMore}
                className="text-muted-foreground justify-center text-xs"
              >
                {section.pagination.loadMoreLabel}
              </CommandItem>
            ) : null}
          </CommandList>
        </Command>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function FilterDropdownMenuOptionAvatar({
  option,
}: {
  option: Pick<
    FilterDropdownMenuOption,
    "avatarLabel" | "image" | "useAgentIcon"
  >;
}) {
  if (!option.avatarLabel) {
    return null;
  }

  if (option.useAgentIcon) {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-current">
        <AgentIcon
          agent={{
            name: option.avatarLabel,
            icon: option.image ?? null,
          }}
          className="size-4 shrink-0"
        />
      </span>
    );
  }

  const fallback = option.avatarLabel.trim().charAt(0).toUpperCase() || "?";

  return (
    <Avatar className="size-5 shrink-0">
      {option.image ? (
        <AvatarImage src={option.image} alt={option.avatarLabel} />
      ) : null}
      <AvatarFallback className="bg-muted text-[0.625rem] font-medium">
        {fallback}
      </AvatarFallback>
    </Avatar>
  );
}

interface FilterDropdownMenuSectionMobileProps {
  section: FilterDropdownMenuSection;
  searchPlaceholder: string;
  emptyResultsLabel: string;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}

function FilterDropdownMenuSectionMobile({
  section,
  searchPlaceholder,
  emptyResultsLabel,
  expanded,
  onToggle,
  onSelect,
}: FilterDropdownMenuSectionMobileProps) {
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
    <div className="border-b pb-4 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="focus:bg-accent flex w-full items-center gap-2 rounded-md p-3 text-left transition-colors hover:bg-accent"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <section.icon className="size-4 text-muted-foreground" aria-hidden />
          <span className="truncate font-medium">{section.label}</span>
        </div>
        <span className="max-w-28 truncate text-right text-xs text-muted-foreground">
          {selectedOption?.label ?? section.allLabel}
        </span>
      </button>
      {expanded ? (
        <div className="mt-2 rounded-md border bg-card p-2">
          <Command
            className="**:data-[slot=command-list]:max-h-[40vh]"
            shouldFilter
          >
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
        </div>
      ) : null}
    </div>
  );
}
