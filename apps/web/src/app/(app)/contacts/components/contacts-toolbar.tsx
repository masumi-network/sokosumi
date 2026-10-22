"use client";
import type { ContactList, ContactStage } from "@sokosumi/core-client";
import {
  ChevronDown,
  GitMerge,
  ListMinus,
  ListPlus,
  Search,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  CONTACT_STAGES,
  LIST_COLOR_DOT,
  STAGE_DOT,
} from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Dot, PersonAvatar } from "./contact-visuals";
import type { Teammate } from "./use-contacts-data";

const CONTROL = "h-10 md:h-8";

/** A filter as a pill: its name, then its value once set, with a clear. */
function FilterMenu({
  label,
  value,
  valueLabel,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  valueLabel?: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  onChange: (value: string | null) => void;
}) {
  const t = useTranslations("App.Contacts.toolbar");
  return (
    <div className="flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className={cn(
              CONTROL,
              "gap-1.5 font-normal",
              value &&
                "border-primary-tertiary bg-primary-quinary rounded-e-none border-e-0",
            )}
          >
            <span className={cn(value && "text-muted-foreground")}>
              {label}
            </span>
            {value ? (
              <span className="max-w-32 truncate font-medium">
                {valueLabel}
              </span>
            ) : null}
            <ChevronDown
              aria-hidden
              className="text-muted-foreground size-3.5"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuRadioGroup
            value={value ?? ""}
            onValueChange={(next) => onChange(next || null)}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="gap-2"
              >
                {option.icon}
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {value ? (
        <Button
          size="icon"
          variant="outline"
          aria-label={t("clearFilter", { filter: label })}
          className="border-primary-tertiary bg-primary-quinary size-10 rounded-s-none md:size-8"
          onClick={() => onChange(null)}
        >
          <X aria-hidden className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export function ContactsFilters({
  search,
  onSearch,
  stage,
  onStage,
  owner,
  onOwner,
  knownBy,
  onKnownBy,
  teammates,
}: {
  search: string;
  onSearch: (value: string) => void;
  stage: ContactStage | null;
  onStage: (value: ContactStage | null) => void;
  owner: string | null;
  onOwner: (value: string | null) => void;
  knownBy: string | null;
  onKnownBy: (value: string | null) => void;
  teammates: Teammate[];
}) {
  const t = useTranslations("App.Contacts");
  const people = [
    { value: "me", label: t("toolbar.me") },
    ...teammates.map((person) => ({
      value: person.id,
      label: person.name,
      icon: <PersonAvatar person={person} />,
    })),
  ];
  const personLabel = (value: string | null) =>
    people.find((person) => person.value === value)?.label;
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          aria-label={t("toolbar.search")}
          placeholder={t("toolbar.searchPlaceholder")}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className={cn(CONTROL, "ps-9")}
        />
      </div>
      <FilterMenu
        label={t("columns.stage")}
        value={stage}
        valueLabel={stage ? t(`stages.${stage}`) : undefined}
        options={CONTACT_STAGES.map((value) => ({
          value,
          label: t(`stages.${value}`),
          icon: <Dot className={STAGE_DOT[value]} />,
        }))}
        onChange={(value) => onStage(value as ContactStage | null)}
      />
      <FilterMenu
        label={t("columns.owner")}
        value={owner}
        valueLabel={personLabel(owner)}
        options={people}
        onChange={onOwner}
      />
      <FilterMenu
        label={t("columns.knownBy")}
        value={knownBy}
        valueLabel={personLabel(knownBy)}
        options={people}
        onChange={onKnownBy}
      />
    </div>
  );
}

/** What a selection can do, in place of the filters while rows are selected. */
export function ContactsBulkBar({
  count,
  lists,
  viewList,
  teammates,
  onAddToList,
  onRemoveFromList,
  onStage,
  onOwner,
  onMerge,
  onClear,
}: {
  count: number;
  lists: ContactList[];
  /** The manual list on screen, offered first for removal. */
  viewList: ContactList | null;
  teammates: Teammate[];
  onAddToList: (list: ContactList) => void;
  onRemoveFromList: (list: ContactList) => void;
  onStage: (stage: ContactStage) => void;
  onOwner: (userId: string | null) => void;
  onMerge: () => void;
  onClear: () => void;
}) {
  const t = useTranslations("App.Contacts");
  const manual = lists.filter((list) => list.kind === "manual");
  const removable = viewList
    ? [viewList, ...manual.filter((list) => list.id !== viewList.id)]
    : manual;
  return (
    <div
      role="toolbar"
      aria-label={t("bulk.label")}
      className="bg-foreground text-background flex flex-wrap items-center gap-1 rounded-lg p-1 ps-3"
    >
      <span className="me-2 text-sm font-medium tabular-nums">
        {t("bulk.selected", { count })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className={cn(CONTROL, "hover:bg-tertiary hover:text-background")}
          >
            <ListPlus aria-hidden className="size-4" />
            {t("bulk.addToList")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {manual.map((list) => (
            <DropdownMenuItem key={list.id} onClick={() => onAddToList(list)}>
              <Dot className={LIST_COLOR_DOT[list.color]} />
              {list.name}
            </DropdownMenuItem>
          ))}
          {manual.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">
              {t("panel.noManualLists")}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className={cn(CONTROL, "hover:bg-tertiary hover:text-background")}
          >
            <ListMinus aria-hidden className="size-4" />
            {t("bulk.removeFromList")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {removable.map((list, index) => (
            <div key={list.id}>
              <DropdownMenuItem onClick={() => onRemoveFromList(list)}>
                <Dot className={LIST_COLOR_DOT[list.color]} />
                {list.name}
              </DropdownMenuItem>
              {viewList && index === 0 && removable.length > 1 ? (
                <DropdownMenuSeparator />
              ) : null}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className={cn(CONTROL, "hover:bg-tertiary hover:text-background")}
          >
            {t("bulk.setStage")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {CONTACT_STAGES.map((stage) => (
            <DropdownMenuItem key={stage} onClick={() => onStage(stage)}>
              <Dot className={STAGE_DOT[stage]} />
              {t(`stages.${stage}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className={cn(CONTROL, "hover:bg-tertiary hover:text-background")}
          >
            {t("bulk.setOwner")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {teammates.map((person) => (
            <DropdownMenuItem
              key={person.id}
              onClick={() => onOwner(person.id)}
            >
              <PersonAvatar person={person} />
              {person.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onOwner(null)}>
            {t("grid.noOwner")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="sm"
        variant="ghost"
        className={cn(CONTROL, "hover:bg-tertiary hover:text-background")}
        disabled={count < 2}
        onClick={onMerge}
      >
        <GitMerge aria-hidden className="size-4" />
        {t("bulk.merge")}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t("bulk.clear")}
        className="hover:bg-tertiary hover:text-background ms-auto size-10 md:size-8"
        onClick={onClear}
      >
        <X aria-hidden className="size-4" />
      </Button>
    </div>
  );
}
