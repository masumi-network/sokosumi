"use client";
import type { ContactList } from "@sokosumi/core-client";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  FileSpreadsheet,
  Hourglass,
  ListFilter,
  type LucideIcon,
  MoreHorizontal,
  Plus,
  Telescope,
  UserRound,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  CONTACT_PRESET_IDS,
  type ContactPreset,
  isContactPreset,
  LIST_COLOR_DOT,
} from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Dot } from "./contact-visuals";

const PRESET_ICONS: Record<ContactPreset, LucideIcon> = {
  all: Users,
  mine: UserRound,
  followUps: CalendarClock,
  recent: Clock,
  stale: Hourglass,
  prospects: Telescope,
};

const ROW =
  "group/rail-row relative flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors md:h-8";

interface Props {
  view: string;
  onViewChange: (view: string) => void;
  lists: ContactList[];
  onNewList: () => void;
  onEditList: (list: ContactList) => void;
  onDeleteList: (list: ContactList) => void;
  onImport: () => void;
}

/** Smart presets, then the team's lists, then import. */
export function ContactsRail({
  view,
  onViewChange,
  lists,
  onNewList,
  onEditList,
  onDeleteList,
  onImport,
}: Props) {
  const t = useTranslations("App.Contacts");
  return (
    <nav aria-label={t("rail.label")} className="flex flex-col gap-6">
      <ul className="flex flex-col gap-0.5">
        {CONTACT_PRESET_IDS.map((preset) => {
          const Icon = PRESET_ICONS[preset];
          const current = view === preset;
          return (
            <li key={preset}>
              <button
                type="button"
                aria-current={current ? "page" : undefined}
                onClick={() => onViewChange(preset)}
                className={cn(
                  ROW,
                  current
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{t(`presets.${preset}`)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <section aria-labelledby="contacts-lists-heading">
        <div className="mb-1 flex items-center justify-between gap-2 ps-2.5">
          <h2
            id="contacts-lists-heading"
            className="text-muted-foreground text-xs font-medium"
          >
            {t("rail.lists")}
          </h2>
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground size-10 md:size-8"
            aria-label={t("rail.newList")}
            onClick={onNewList}
          >
            <Plus aria-hidden className="size-4" />
          </Button>
        </div>
        <ul className="flex flex-col gap-0.5">
          {lists.map((list) => {
            const current = view === list.id;
            return (
              <li key={list.id} className="group/list relative">
                <button
                  type="button"
                  aria-current={current ? "page" : undefined}
                  onClick={() => onViewChange(list.id)}
                  className={cn(
                    ROW,
                    "pe-10 md:pe-9",
                    current
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <Dot className={LIST_COLOR_DOT[list.color]} />
                  </span>
                  <span className="truncate">{list.name}</span>
                  {list.kind === "smart" ? (
                    <ListFilter
                      aria-label={t("rail.smartList")}
                      className="size-3.5 shrink-0"
                    />
                  ) : null}
                  <span className="text-muted-foreground ms-auto text-xs tabular-nums transition-opacity group-focus-within/list:opacity-0 group-hover/list:opacity-0">
                    {list.count}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("rail.listMenu", { name: list.name })}
                      className="text-muted-foreground absolute end-0 top-0 size-10 opacity-0 transition-opacity group-focus-within/list:opacity-100 group-hover/list:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100 md:size-8"
                    >
                      <MoreHorizontal aria-hidden className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEditList(list)}>
                      {t("rail.editList")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onDeleteList(list)}
                    >
                      {t("rail.deleteList")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
        {lists.length === 0 ? (
          <p className="text-muted-foreground px-2.5 py-1 text-xs">
            {t("rail.noLists")}
          </p>
        ) : null}
      </section>
      <button
        type="button"
        onClick={onImport}
        className={cn(
          ROW,
          "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
        )}
      >
        <FileSpreadsheet aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{t("rail.import")}</span>
      </button>
    </nav>
  );
}

/** The rail as one menu, for phones. */
export function ContactsViewPicker({
  view,
  onViewChange,
  lists,
  onNewList,
}: Pick<Props, "view" | "onViewChange" | "lists" | "onNewList">) {
  const t = useTranslations("App.Contacts");
  const current = isContactPreset(view)
    ? t(`presets.${view}`)
    : (lists.find((list) => list.id === view)?.name ?? t("presets.all"));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          <span className="truncate">{current}</span>
          <ChevronDown aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {CONTACT_PRESET_IDS.map((preset) => (
          <DropdownMenuItem key={preset} onClick={() => onViewChange(preset)}>
            {t(`presets.${preset}`)}
            {view === preset ? (
              <Check aria-hidden className="ms-auto size-4" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("rail.lists")}</DropdownMenuLabel>
        {lists.map((list) => (
          <DropdownMenuItem key={list.id} onClick={() => onViewChange(list.id)}>
            <Dot className={LIST_COLOR_DOT[list.color]} />
            <span className="truncate">{list.name}</span>
            <span className="text-muted-foreground ms-auto text-xs tabular-nums">
              {list.count}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={onNewList}>
          <Plus aria-hidden className="size-4" />
          {t("rail.newList")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
