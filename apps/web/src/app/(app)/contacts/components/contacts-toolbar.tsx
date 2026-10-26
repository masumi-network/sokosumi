"use client";
import type {
  ContactKind,
  ContactList,
  ContactReplyState,
  ContactStage,
} from "@sokosumi/core-client";
import {
  ChevronDown,
  GitMerge,
  ListFilter,
  ListMinus,
  ListPlus,
  Search,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";
import {
  CONTACT_KINDS,
  CONTACT_REPLY_STATES,
  LIST_COLOR_DOT,
  REPLY_DOT,
  STAGE_DOT,
  STAGE_GROUPS,
} from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Dot, PersonAvatar } from "./contact-visuals";
import type { Teammate } from "./use-contacts-data";

const CONTROL = "h-10 md:h-8";

/** The filters the toolbar narrows a view with; all live in the URL. */
export interface ContactFilters {
  stage: ContactStage | null;
  replyState: ContactReplyState | null;
  kind: ContactKind | null;
  /** `me` or a member's user id. */
  knownBy: string | null;
}

export type ContactFilterKey = keyof ContactFilters;

interface FilterOption {
  value: string;
  label: string;
  icon?: ReactNode;
  group?: string;
}

/** Radio items, with a label above each group when the options have groups. */
export function GroupedRadioItems({ options }: { options: FilterOption[] }) {
  return options.map((option, index) => {
    const startsGroup =
      option.group && option.group !== options[index - 1]?.group;
    return (
      <Fragment key={option.value}>
        {startsGroup ? (
          <>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              {option.group}
            </DropdownMenuLabel>
          </>
        ) : null}
        <DropdownMenuRadioItem value={option.value} className="gap-2">
          {option.icon}
          {option.label}
        </DropdownMenuRadioItem>
      </Fragment>
    );
  });
}

/** Every stage as a grouped choice, for menus and grid cells. */
export function useStageOptions(): FilterOption[] {
  const t = useTranslations("App.Contacts");
  return Object.entries(STAGE_GROUPS).flatMap(([group, stages]) =>
    stages.map((stage) => ({
      value: stage,
      label: t(`stages.${stage}`),
      icon: <Dot className={STAGE_DOT[stage]} />,
      group: t(`stageGroups.${group}`),
    })),
  );
}

/**
 * Search, one Filter menu, `menus` beside it and the filters in force as
 * removable chips, on a single row: the chrome stays one line high however
 * many filters exist.
 */
export function ContactsFilterBar({
  search,
  onSearch,
  filters,
  onFilter,
  teammates,
  menus: extraMenus,
}: {
  search: string;
  onSearch: (value: string) => void;
  filters: ContactFilters;
  onFilter: (key: ContactFilterKey, value: string | null) => void;
  teammates: Teammate[];
  menus?: ReactNode;
}) {
  const t = useTranslations("App.Contacts");
  const stageOptions = useStageOptions();
  const people: FilterOption[] = [
    { value: "me", label: t("toolbar.me") },
    ...teammates.map((person) => ({
      value: person.id,
      label: person.name,
      icon: <PersonAvatar person={person} />,
    })),
  ];
  const menus: {
    key: ContactFilterKey;
    label: string;
    options: FilterOption[];
  }[] = [
    { key: "stage", label: t("columns.stage"), options: stageOptions },
    {
      key: "replyState",
      label: t("columns.reply"),
      options: CONTACT_REPLY_STATES.map((state) => ({
        value: state,
        label: t(`replyStates.${state}`),
        icon: <Dot className={REPLY_DOT[state]} />,
      })),
    },
    {
      key: "kind",
      label: t("toolbar.kind"),
      options: CONTACT_KINDS.map((kind) => ({
        value: kind,
        label: t(`kinds.${kind}`),
      })),
    },
    { key: "knownBy", label: t("columns.knownBy"), options: people },
  ];
  const active = menus.filter((menu) => filters[menu.key]);
  return (
    <>
      <div className="relative order-last w-full sm:order-none sm:w-56">
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
          className={cn(CONTROL, "border-control-border bg-background ps-9")}
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className={cn(CONTROL, "gap-1.5 font-normal")}
          >
            <ListFilter aria-hidden className="size-4" />
            {t("toolbar.filter")}
            <ChevronDown
              aria-hidden
              className="text-muted-foreground size-3.5"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          {menus.map((menu) => (
            <DropdownMenuSub key={menu.key}>
              <DropdownMenuSubTrigger>{menu.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-96 min-w-52 overflow-y-auto">
                <DropdownMenuRadioGroup
                  value={filters[menu.key] ?? ""}
                  onValueChange={(value) => onFilter(menu.key, value || null)}
                >
                  <GroupedRadioItems options={menu.options} />
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {extraMenus}
      {active.map((menu) => {
        const value = menu.options.find(
          (option) => option.value === filters[menu.key],
        );
        return (
          <span
            key={menu.key}
            className="border-primary-tertiary bg-primary-quinary inline-flex h-10 items-center gap-1 rounded-full border ps-3 text-sm md:h-8"
          >
            <span className="text-muted-foreground">{menu.label}</span>
            <span className="max-w-32 truncate font-medium">
              {value?.label}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("toolbar.clearFilter", { filter: menu.label })}
              className="size-10 rounded-full md:size-8"
              onClick={() => onFilter(menu.key, null)}
            >
              <X aria-hidden className="size-3.5" />
            </Button>
          </span>
        );
      })}
    </>
  );
}

/** What a selection can do, in place of the filters while rows are selected. */
export function ContactsBulkBar({
  count,
  lists,
  viewList,
  onAddToList,
  onRemoveFromList,
  onMerge,
  onClear,
}: {
  count: number;
  lists: ContactList[];
  /** The manual list on screen, offered first for removal. */
  viewList: ContactList | null;
  onAddToList: (list: ContactList) => void;
  onRemoveFromList: (list: ContactList) => void;
  onMerge: () => void;
  onClear: () => void;
}) {
  const t = useTranslations("App.Contacts");
  const manual = lists.filter((list) => list.kind === "manual");
  const removable = viewList
    ? [viewList, ...manual.filter((list) => list.id !== viewList.id)]
    : manual;
  // The filter row's own height and buttons, on one line: selecting a row
  // swaps the controls in place instead of growing the header.
  const action = cn(CONTROL, "shrink-0");
  return (
    <div
      role="toolbar"
      aria-label={t("bulk.label")}
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
    >
      <span className="me-2 shrink-0 text-sm font-medium tabular-nums">
        {t("bulk.selected", { count })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className={action}>
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
          <Button size="sm" variant="ghost" className={action}>
            <ListMinus aria-hidden className="size-4" />
            {t("bulk.removeFromList")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {removable.map((list, index) => (
            <Fragment key={list.id}>
              <DropdownMenuItem onClick={() => onRemoveFromList(list)}>
                <Dot className={LIST_COLOR_DOT[list.color]} />
                {list.name}
              </DropdownMenuItem>
              {viewList && index === 0 && removable.length > 1 ? (
                <DropdownMenuSeparator />
              ) : null}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="sm"
        variant="ghost"
        className={action}
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
        className="hit-area size-10 shrink-0 md:size-8"
        onClick={onClear}
      >
        <X aria-hidden className="size-4" />
      </Button>
    </div>
  );
}
