"use client";
import type { ContactList } from "@sokosumi/core-client";
import {
  Building2,
  Check,
  ChevronDown,
  ListFilter,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  CONTACT_PRESET_IDS,
  isContactPreset,
  LIST_COLOR_DOT,
} from "@/app/contacts/contacts-view";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Dot } from "./contact-visuals";

/** The Filter menu's trigger, so the row reads as one set of controls. */
const TRIGGER = "h-10 gap-1.5 font-normal md:h-8";
const CHEVRON = "text-muted-foreground size-3.5 shrink-0";

interface Props {
  view: string;
  onViewChange: (view: string) => void;
  lists: ContactList[];
  onNewList: () => void;
  onEditList: (list: ContactList) => void;
  onDeleteList: (list: ContactList) => void;
  organization: string | null;
  /** The biggest companies, or Core's matches for the menu's search. */
  organizations: { name: string; count: number }[];
  onOrganizationChange: (organization: string | null) => void;
  /** What the Companies menu's search box says; Core searches every company. */
  onCompanySearch: (search: string) => void;
}

/** The presets as tabs, at the top of the page. */
export function ContactsPresetTabs({
  view,
  onViewChange,
}: Pick<Props, "view" | "onViewChange">) {
  const t = useTranslations("App.Contacts");
  return (
    <Tabs
      value={isContactPreset(view) ? view : ""}
      onValueChange={onViewChange}
      className="max-w-full min-w-0"
    >
      <TabsList
        aria-label={t("views.label")}
        className={cn(
          SEGMENTED_TABS_LIST_CLASS_NAME,
          "w-fit max-w-full justify-start overflow-x-auto",
        )}
      >
        {CONTACT_PRESET_IDS.map((preset) => (
          <TabsTrigger
            key={preset}
            value={preset}
            className={cn(SEGMENTED_TAB_TRIGGER_CLASS_NAME, "shrink-0")}
          >
            {t(`presets.${preset}`)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** The team's lists and the companies as menus, beside the Filter menu. */
export function ContactsViewMenus({
  view,
  onViewChange,
  lists,
  onNewList,
  onEditList,
  onDeleteList,
  organization,
  organizations,
  onOrganizationChange,
  onCompanySearch,
}: Props) {
  return (
    <>
      <ListsMenu
        view={view}
        onViewChange={onViewChange}
        lists={lists}
        onNewList={onNewList}
        onEditList={onEditList}
        onDeleteList={onDeleteList}
      />
      <CompaniesMenu
        organization={organization}
        organizations={organizations}
        onChange={onOrganizationChange}
        onSearch={onCompanySearch}
      />
    </>
  );
}

function ListsMenu({
  view,
  onViewChange,
  lists,
  onNewList,
  onEditList,
  onDeleteList,
}: Pick<
  Props,
  | "view"
  | "onViewChange"
  | "lists"
  | "onNewList"
  | "onEditList"
  | "onDeleteList"
>) {
  const t = useTranslations("App.Contacts");
  const current = lists.find((list) => list.id === view) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={current ? "secondary" : "outline"}
          size="sm"
          className={cn(TRIGGER, "max-w-64")}
        >
          {current ? <Dot className={LIST_COLOR_DOT[current.color]} /> : null}
          <span className="truncate">{current?.name ?? t("views.lists")}</span>
          <ChevronDown aria-hidden className={CHEVRON} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("views.lists")}</DropdownMenuLabel>
        {lists.map((list) => (
          <DropdownMenuItem key={list.id} onClick={() => onViewChange(list.id)}>
            <Dot className={LIST_COLOR_DOT[list.color]} />
            <span className="truncate">{list.name}</span>
            {list.kind === "smart" ? (
              <ListFilter
                aria-label={t("views.smartList")}
                className="size-3.5 shrink-0"
              />
            ) : list.createdAutomatically ? (
              <Sparkles
                aria-label={t("views.autoList")}
                className="size-3.5 shrink-0"
              />
            ) : null}
            <span className="text-muted-foreground ms-auto text-xs tabular-nums">
              {list.count}
            </span>
            {list.id === view ? (
              <Check aria-hidden className="size-4 shrink-0" />
            ) : null}
          </DropdownMenuItem>
        ))}
        {lists.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-sm">
            {t("views.noLists")}
          </p>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNewList}>
          <Plus aria-hidden className="size-4" />
          {t("views.newList")}
        </DropdownMenuItem>
        {current ? (
          <>
            <DropdownMenuItem onClick={() => onEditList(current)}>
              {t("views.editList")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDeleteList(current)}
            >
              {t("views.deleteList")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CompaniesMenu({
  organization,
  organizations,
  onChange,
  onSearch,
}: {
  organization: string | null;
  organizations: Props["organizations"];
  onChange: (organization: string | null) => void;
  onSearch: (search: string) => void;
}) {
  const t = useTranslations("App.Contacts");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  function changeSearch(next: string) {
    setSearch(next);
    onSearch(next);
  }
  return (
    <div className="flex items-center">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) changeSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant={organization ? "secondary" : "outline"}
            size="sm"
            className={cn(
              TRIGGER,
              "max-w-64",
              organization && "rounded-e-none",
            )}
          >
            <Building2 aria-hidden className="size-4 shrink-0" />
            <span className="truncate">
              {organization ?? t("views.companies")}
            </span>
            <ChevronDown aria-hidden className={CHEVRON} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          {/* Core searches all companies; the list shows its answer as is. */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t("views.findCompany")}
              value={search}
              onValueChange={changeSearch}
            />
            <CommandList>
              <CommandEmpty>{t("views.noCompanies")}</CommandEmpty>
              <CommandGroup>
                {organizations.map((company) => (
                  <CommandItem
                    key={company.name}
                    value={company.name}
                    onSelect={() => {
                      onChange(company.name);
                      setOpen(false);
                      changeSearch("");
                    }}
                  >
                    <span className="truncate">{company.name}</span>
                    <span className="text-muted-foreground ms-auto text-xs tabular-nums">
                      {company.count}
                    </span>
                    {company.name === organization ? (
                      <Check aria-hidden className="size-4 shrink-0" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {organization ? (
        <Button
          variant="secondary"
          size="icon"
          className="hit-area size-10 rounded-s-none border-s-0 md:size-8"
          aria-label={t("views.clearCompany")}
          onClick={() => onChange(null)}
        >
          <X aria-hidden className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
