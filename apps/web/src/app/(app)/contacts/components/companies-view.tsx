"use client";
import type { ContactCompany, ContactCompanyList } from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Building2, ListMinus, ListPlus, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import {
  coreErrorOf,
  LIST_COLOR_DOT,
  replaceVisibleSelection,
} from "@/app/contacts/contacts-view";
import { EmptyState } from "@/components/common/empty-state";
import { PageSearchActions } from "@/components/page-search-actions";
import { PageSearchField } from "@/components/page-search-field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEnvPublicConfig } from "@/config/env.public";
import type { CompanyQuery } from "@/lib/services/contacts.client";
import { contactsService } from "@/lib/services/contacts.client";
import { cn } from "@/lib/utils";
import { WARMTH_DOT } from "./company-header";
import { ContactListDialog } from "./contact-list-dialog";
import { Dot, ListChip } from "./contact-visuals";
import { ListsMenu } from "./contacts-views-bar";
import {
  COMPANIES_KEY,
  COMPANY_LISTS_KEY,
  useCompanies,
  useCompanyLists,
} from "./use-contacts-data";

/** Core returns at most this many companies per read. */
const LIMIT = 500;
const CONTROL = "h-10 md:h-8";

type CompanySort = NonNullable<CompanyQuery["sort"]>;
type Dialog =
  | { kind: "list"; list?: ContactCompanyList }
  | { kind: "deleteList"; list: ContactCompanyList };

/**
 * One row per company the contacts work at, with the relationship there,
 * and the team's company lists. Opening a company shows its people.
 */
export function CompaniesView({
  onOpenCompany,
}: {
  onOpenCompany: (name: string) => void;
}) {
  const t = useTranslations("App.Contacts.companies");
  const tc = useTranslations("App.Contacts.company");
  const te = useTranslations("App.Contacts.errors");
  const format = useFormatter();
  const cache = useQueryClient();
  const [listId, setListId] = useQueryState("companyList", parseAsString);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(
    search.trim(),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );
  const [sort, setSort] = useState<CompanySort>("people");
  const [selectedIds, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const lists = useCompanyLists();
  const allLists = lists.data ?? [];
  const currentList = allLists.find((list) => list.id === listId) ?? null;
  const query: CompanyQuery = {
    sort,
    limit: LIMIT,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(currentList ? { listId: currentList.id } : {}),
  };
  const companies = useCompanies(query, true);
  const rows = companies.data?.companies ?? [];
  const total = companies.data?.total ?? 0;
  const listsById = new Map(allLists.map((list) => [list.id, list]));
  const selection = new Set(selectedIds);
  const selected = rows
    .filter((row) => selection.has(row.id))
    .map((row) => row.id);
  const allSelected = rows.length > 0 && selected.length === rows.length;

  function changeList(next: string | null) {
    void setListId(next);
    setSelected([]);
  }

  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: COMPANIES_KEY }),
      cache.invalidateQueries({ queryKey: COMPANY_LISTS_KEY }),
    ]);
  }

  async function changeMembers(
    list: ContactCompanyList,
    change: { add?: string[]; remove?: string[] },
    done: string,
  ) {
    try {
      await contactsService.changeCompanyMembers(list.id, change);
      toast.success(done);
      if (change.remove?.length && list.id === currentList?.id) setSelected([]);
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("saveFailed"));
    } finally {
      await refresh();
    }
  }

  async function deleteList(list: ContactCompanyList) {
    try {
      await contactsService.deleteCompanyList(list.id);
      if (listId === list.id) changeList(null);
      setDialog(null);
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("saveFailed"));
    } finally {
      await refresh();
    }
  }

  const removable = currentList
    ? [currentList, ...allLists.filter((list) => list.id !== currentList.id)]
    : allLists;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="@container/page-toolbar flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
          {companies.isPending ? null : t("count", { count: total })}
        </span>
        <PageSearchActions>
          <PageSearchField
            inHeader
            aria-label={t("search")}
            placeholder={t("searchPlaceholder")}
            value={search}
            maxLength={200}
            onValueChange={setSearch}
          />
          {selected.length ? (
            <div
              role="toolbar"
              aria-label={t("bulkLabel")}
              className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            >
              <span className="me-2 shrink-0 text-sm font-medium tabular-nums">
                {t("selected", { count: selected.length })}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(CONTROL, "shrink-0")}
                  >
                    <ListPlus aria-hidden className="size-4" />
                    {t("addToList")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {allLists.map((list) => (
                    <DropdownMenuItem
                      key={list.id}
                      onClick={() =>
                        void changeMembers(
                          list,
                          { add: selected },
                          t("addedToList", {
                            count: selected.length,
                            list: list.name,
                          }),
                        )
                      }
                    >
                      <Dot className={LIST_COLOR_DOT[list.color]} />
                      {list.name}
                    </DropdownMenuItem>
                  ))}
                  {allLists.length === 0 ? (
                    <DropdownMenuItem
                      onClick={() => setDialog({ kind: "list" })}
                    >
                      <ListPlus aria-hidden className="size-4" />
                      {t("newList")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
              {removable.length ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn(CONTROL, "shrink-0")}
                    >
                      <ListMinus aria-hidden className="size-4" />
                      {t("removeFromList")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {removable.map((list) => (
                      <DropdownMenuItem
                        key={list.id}
                        onClick={() =>
                          void changeMembers(
                            list,
                            { remove: selected },
                            t("removedFromList", {
                              count: selected.length,
                              list: list.name,
                            }),
                          )
                        }
                      >
                        <Dot className={LIST_COLOR_DOT[list.color]} />
                        {list.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className={cn(CONTROL, "shrink-0")}
                onClick={() => setSelected([])}
              >
                <X aria-hidden className="size-4" />
                {t("clearSelection")}
              </Button>
            </div>
          ) : (
            <>
              <ListsMenu
                companies
                view={listId ?? ""}
                onViewChange={changeList}
                lists={allLists}
                onNewList={() => setDialog({ kind: "list" })}
                onEditList={(list) => setDialog({ kind: "list", list })}
                onDeleteList={(list) => setDialog({ kind: "deleteList", list })}
              />
              {currentList ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className={CONTROL}
                  onClick={() => changeList(null)}
                >
                  <X aria-hidden className="size-4" />
                  {t("allCompanies")}
                </Button>
              ) : null}
            </>
          )}
        </PageSearchActions>
      </div>
      {currentList?.description ? (
        <p className="text-muted-foreground -mt-1 truncate text-sm">
          {currentList.description}
        </p>
      ) : null}
      <div className={cn(HOLDER_CLASS, "min-w-0")}>
        <div className={cn(HOLDER_ITEM_CLASS, "min-w-0 overflow-hidden")}>
          {companies.isPending ? (
            <div className="grid gap-2 p-4" role="status">
              <span className="sr-only">{t("loading")}</span>
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : companies.error ? (
            <EmptyState
              title={t("loadFailed")}
              description={coreErrorOf(companies.error).message ?? te("load")}
              action={
                <Button
                  variant="outline"
                  onClick={() => void companies.refetch()}
                >
                  {t("retry")}
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={t("emptyTitle")}
              description={
                debouncedSearch
                  ? t("noMatches")
                  : currentList
                    ? t("emptyList")
                    : t("empty")
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 ps-4">
                    <Checkbox
                      aria-label={t("selectAll")}
                      checked={
                        allSelected
                          ? true
                          : selected.length
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          replaceVisibleSelection(
                            current,
                            selected,
                            checked === true ? rows.map((row) => row.id) : [],
                          ),
                        )
                      }
                    />
                  </TableHead>
                  <SortHead
                    label={t("columns.name")}
                    active={sort === "name"}
                    onSort={() => setSort("name")}
                  />
                  <SortHead
                    label={t("columns.people")}
                    active={sort === "people"}
                    onSort={() => setSort("people")}
                    className="text-end"
                  />
                  <TableHead className="hidden sm:table-cell">
                    {tc("warmth")}
                  </TableHead>
                  <SortHead
                    label={tc("lastContact")}
                    active={sort === "lastContact"}
                    onSort={() => setSort("lastContact")}
                    className="hidden sm:table-cell"
                  />
                  <TableHead className="hidden lg:table-cell">
                    {t("columns.industry")}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t("columns.lists")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((company) => (
                  <CompanyRow
                    key={company.id}
                    company={company}
                    selected={selection.has(company.id)}
                    onSelect={(checked) =>
                      setSelected((current) =>
                        checked
                          ? [...current, company.id]
                          : current.filter((id) => id !== company.id),
                      )
                    }
                    onOpen={() => onOpenCompany(company.name)}
                    lists={company.listIds.flatMap((id) => {
                      const list = listsById.get(id);
                      return list ? [list] : [];
                    })}
                    lastContact={
                      company.lastContactAt
                        ? format.relativeTime(
                            new Date(company.lastContactAt),
                            new Date(),
                          )
                        : tc("never")
                    }
                    warmth={tc(`warmthLevels.${company.warmth}`)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
          {rows.length > 0 && total > rows.length ? (
            <p className="text-muted-foreground border-t px-4 py-2 text-sm">
              {t("showing", { shown: rows.length, total })}
            </p>
          ) : null}
        </div>
      </div>
      {dialog?.kind === "list" ? (
        <ContactListDialog
          companies
          list={dialog.list}
          onClose={() => setDialog(null)}
          onSaved={(list) => {
            setDialog(null);
            void refresh();
            if (!dialog.list) changeList(list.id);
          }}
        />
      ) : null}
      <AlertDialog
        open={dialog?.kind === "deleteList"}
        onOpenChange={(isOpen) => !isOpen && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deleteTitle", {
                name: dialog?.kind === "deleteList" ? dialog.list.name : "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={(event) => {
                event.preventDefault();
                if (dialog?.kind === "deleteList") void deleteList(dialog.list);
              }}
            >
              {t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SortHead({
  label,
  active,
  onSort,
  className,
}: {
  label: string;
  active: boolean;
  onSort: () => void;
  className?: string;
}) {
  return (
    <TableHead
      className={className}
      aria-sort={active ? "descending" : undefined}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1",
          active && "text-foreground",
        )}
      >
        {label}
        {active ? <ArrowDown aria-hidden className="size-3.5" /> : null}
      </button>
    </TableHead>
  );
}

function CompanyRow({
  company,
  selected,
  onSelect,
  onOpen,
  lists,
  lastContact,
  warmth,
}: {
  company: ContactCompany;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
  lists: ContactCompanyList[];
  lastContact: string;
  warmth: string;
}) {
  const t = useTranslations("App.Contacts.companies");
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className="cursor-pointer"
      onClick={onOpen}
    >
      <TableCell className="ps-4" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          aria-label={t("select", { name: company.name })}
          checked={selected}
          onCheckedChange={(checked) => onSelect(checked === true)}
        />
      </TableCell>
      <TableCell className="max-w-72">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="grid min-w-0 text-start"
        >
          <span className="truncate font-medium">{company.name}</span>
          {company.domain ? (
            <span className="text-muted-foreground truncate text-xs">
              {company.domain}
            </span>
          ) : null}
        </button>
      </TableCell>
      <TableCell className="text-end tabular-nums">{company.people}</TableCell>
      <TableCell className="hidden sm:table-cell">
        <span className="inline-flex items-center gap-1.5">
          <Dot className={WARMTH_DOT[company.warmth]} />
          {warmth}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground hidden sm:table-cell">
        {lastContact}
      </TableCell>
      <TableCell className="text-muted-foreground hidden max-w-48 truncate lg:table-cell">
        {company.industry}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="flex max-w-80 gap-1 overflow-hidden">
          {lists.map((list) => (
            <ListChip key={list.id} name={list.name} color={list.color} />
          ))}
        </span>
      </TableCell>
    </TableRow>
  );
}
