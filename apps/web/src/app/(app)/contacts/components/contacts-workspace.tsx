"use client";
import type {
  Contact,
  ContactKind,
  ContactList,
  ContactReplyState,
  ContactStage,
} from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileSpreadsheet,
  ListPlus,
  MoreHorizontal,
  UserPlus,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import {
  CONTACT_KINDS,
  CONTACT_REPLY_STATES,
  CONTACT_SORTS,
  CONTACT_STAGES,
  type ContactSort,
  contactQuery,
  coreErrorOf,
  defaultDirection,
  isContactPreset,
  matchesContactSearch,
} from "@/app/contacts/contacts-view";
import { EmptyState } from "@/components/common/empty-state";
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
import { getEnvPublicConfig } from "@/config/env.public";
import { contactsService } from "@/lib/services/contacts.client";
import type { SokoBotConnectOffer } from "@/lib/soko-bot/connect-prompt";
import { cn } from "@/lib/utils";
import { AddContactDialog } from "./add-contact-dialog";
import { ContactListDialog } from "./contact-list-dialog";
import { ContactPanel } from "./contact-panel";
import { ContactsEmptyState } from "./contacts-empty-state";
import { ContactsGrid } from "./contacts-grid";
import { ContactsList } from "./contacts-list";
import {
  type ContactFilterKey,
  type ContactFilters,
  ContactsBulkBar,
  ContactsFilterBar,
} from "./contacts-toolbar";
import { ContactsPresetTabs, ContactsViewMenus } from "./contacts-views-bar";
import { ImportContactsDialog } from "./import-contacts-dialog";
import { MergeContactsDialog } from "./merge-contacts-dialog";
import { useContactUpdate, useImportanceUpdate } from "./use-contact-update";
import {
  CONTACT_LISTS_KEY,
  refreshContacts,
  useContactLists,
  useContactOrganizations,
  useContactRows,
  useTeammates,
} from "./use-contacts-data";

type Dialog =
  | { kind: "add" }
  | { kind: "import" }
  | { kind: "list"; list?: ContactList }
  | { kind: "deleteList"; list: ContactList }
  | { kind: "merge"; contacts: Contact[] };

/** The Contacts tab: views and companies on top, the grid, and the person panel. */
export function ContactsWorkspace({
  connectOffers,
}: {
  connectOffers: SokoBotConnectOffer[] | null;
}) {
  const t = useTranslations("App.Contacts");
  const cache = useQueryClient();
  const update = useContactUpdate();
  const setImportance = useImportanceUpdate();
  const [view, setView] = useQueryState(
    "list",
    parseAsString.withDefault("all"),
  );
  const [search, setSearch] = useQueryState("q", parseAsString.withDefault(""));
  const [company, setCompany] = useQueryState("company");
  const [companySearch, setCompanySearch] = useState("");
  const [debouncedCompanySearch] = useDebounce(
    companySearch.trim(),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );
  const [stage, setStage] = useQueryState(
    "stage",
    parseAsStringLiteral(CONTACT_STAGES),
  );
  const [replyState, setReplyState] = useQueryState(
    "reply",
    parseAsStringLiteral(CONTACT_REPLY_STATES),
  );
  const [kind, setKind] = useQueryState(
    "kind",
    parseAsStringLiteral(CONTACT_KINDS),
  );
  const [knownBy, setKnownBy] = useQueryState("knownBy");
  const [sort, setSort] = useQueryState(
    "sort",
    parseAsStringLiteral(CONTACT_SORTS).withDefault("lastContactAt"),
  );
  const [direction, setDirection] = useQueryState(
    "dir",
    parseAsStringLiteral(["asc", "desc"] as const),
  );
  const [openId, setOpenId] = useQueryState("contact");
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [exporting, setExporting] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Core searches once per pause in typing; meanwhile every keystroke filters
  // the rows already on screen, so the table answers as you type.
  const [debouncedSearch] = useDebounce(
    search,
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  const { teammates } = useTeammates();
  const lists = useContactLists();
  const organizations = useContactOrganizations(debouncedCompanySearch);
  const filters: ContactFilters = { stage, replyState, kind, knownBy };
  const query = contactQuery({
    view,
    company,
    search: debouncedSearch,
    ...filters,
    sort,
    direction: direction ?? defaultDirection(sort),
  });
  const rows = useContactRows(query);
  const loaded = rows.data?.pages.flatMap((page) => page.contacts) ?? [];
  const searchPending = search !== debouncedSearch || rows.isPlaceholderData;
  const contacts =
    searchPending && search.trim()
      ? loaded.filter((contact) => matchesContactSearch(contact, search))
      : loaded;
  const total = rows.data?.pages[0]?.total ?? 0;
  const viewList = lists.data?.find((list) => list.id === view) ?? null;
  const filtered =
    !!search.trim() || !!company || Object.values(filters).some(Boolean);
  const setFilter: Record<
    ContactFilterKey,
    (value: string | null) => Promise<unknown>
  > = {
    stage: (value) => setStage(value as ContactStage | null),
    replyState: (value) => setReplyState(value as ContactReplyState | null),
    kind: (value) => setKind(value as ContactKind | null),
    knownBy: setKnownBy,
  };
  function clearFilters() {
    void setSearch(null);
    void setCompany(null);
    for (const set of Object.values(setFilter)) void set(null);
  }
  const selectedContacts = contacts.filter((contact) =>
    selected.includes(contact.id),
  );
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = rows;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  function changeView(next: string) {
    void setView(next === "all" ? null : next);
    setSelected([]);
  }
  function changeOrganization(next: string | null) {
    void setCompany(next);
    setSelected([]);
  }
  function handleSort(next: ContactSort) {
    if (next === sort)
      void setDirection(
        (direction ?? defaultDirection(sort)) === "asc" ? "desc" : "asc",
      );
    else {
      void setSort(next);
      void setDirection(null);
    }
  }
  function open(id: string) {
    if (!openId && document.activeElement instanceof HTMLElement)
      returnFocus.current = document.activeElement;
    void setOpenId(id);
  }
  function restoreFocus(event: Event) {
    const target = returnFocus.current;
    returnFocus.current = null;
    if (!target?.isConnected) return;
    event.preventDefault();
    target.focus();
  }

  async function bulk(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast.success(done);
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("errors.saveFailed"));
    } finally {
      await refreshContacts(cache);
    }
  }
  async function handleExport() {
    setExporting(true);
    try {
      const csv = await contactsService.exportCsv(query);
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("errors.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  async function deleteList(list: ContactList) {
    try {
      await contactsService.deleteList(list.id);
      if (view === list.id) changeView("all");
      await cache.invalidateQueries({ queryKey: CONTACT_LISTS_KEY });
      await refreshContacts(cache);
      setDialog(null);
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("errors.saveFailed"));
    }
  }

  const workspaceEmpty =
    !rows.isPending && total === 0 && view === "all" && !filtered;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-3">
        <header className="flex min-w-0 items-start gap-2">
          <h1 className="sr-only">{t("title")}</h1>
          <div className="min-w-0 flex-1">
            <ContactsPresetTabs view={view} onViewChange={changeView} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="primary"
              className="h-10 md:h-8"
              onClick={() => setDialog({ kind: "add" })}
            >
              <UserPlus aria-hidden className="size-4" />
              <span className="sr-only sm:not-sr-only">{t("toolbar.add")}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={exporting}>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("toolbar.more")}
                  className="size-10 md:size-8"
                  loading={exporting}
                >
                  <MoreHorizontal aria-hidden className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void handleExport()}>
                  <Download aria-hidden className="size-4" />
                  {t("toolbar.export")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog({ kind: "import" })}>
                  <FileSpreadsheet aria-hidden className="size-4" />
                  {t("views.import")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog({ kind: "list" })}>
                  <ListPlus aria-hidden className="size-4" />
                  {t("views.newList")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {selected.length ? (
            <ContactsBulkBar
              count={selected.length}
              lists={lists.data ?? []}
              viewList={viewList?.kind === "manual" ? viewList : null}
              onAddToList={(list) =>
                void bulk(
                  () =>
                    contactsService.changeMembers(list.id, { add: selected }),
                  t("bulk.addedToList", {
                    count: selected.length,
                    list: list.name,
                  }),
                )
              }
              onRemoveFromList={(list) =>
                void bulk(
                  async () => {
                    await contactsService.changeMembers(list.id, {
                      remove: selected,
                    });
                    if (view === list.id) setSelected([]);
                  },
                  t("bulk.removedFromList", {
                    count: selected.length,
                    list: list.name,
                  }),
                )
              }
              onMerge={() =>
                setDialog({ kind: "merge", contacts: selectedContacts })
              }
              onClear={() => setSelected([])}
            />
          ) : (
            <ContactsFilterBar
              search={search}
              onSearch={(value) => {
                void setSearch(value || null);
                setSelected([]);
              }}
              filters={filters}
              onFilter={(key, value) => {
                void setFilter[key](value);
                setSelected([]);
              }}
              teammates={teammates}
              menus={
                <ContactsViewMenus
                  view={view}
                  onViewChange={changeView}
                  lists={lists.data ?? []}
                  onNewList={() => setDialog({ kind: "list" })}
                  onEditList={(list) => setDialog({ kind: "list", list })}
                  onDeleteList={(list) =>
                    setDialog({ kind: "deleteList", list })
                  }
                  organization={company}
                  organizations={organizations.data ?? []}
                  onCompanySearch={setCompanySearch}
                  onOrganizationChange={changeOrganization}
                />
              }
            />
          )}
          <span className="text-muted-foreground ms-auto shrink-0 text-sm tabular-nums">
            {rows.isPending ? null : t("count", { count: total })}
          </span>
        </div>
        {viewList?.description ? (
          <p className="text-muted-foreground -mt-1 truncate text-sm">
            {viewList.description}
          </p>
        ) : null}
        <div className={cn(HOLDER_CLASS, "min-w-0")}>
          <div className={cn(HOLDER_ITEM_CLASS, "min-w-0 overflow-hidden")}>
            {rows.isPending || (searchPending && contacts.length === 0) ? (
              <div className="grid gap-2 p-4" role="status">
                <span className="sr-only">{t("loading")}</span>
                {Array.from({ length: 8 }, (_, index) => (
                  <Skeleton key={index} className="h-8 w-full" />
                ))}
              </div>
            ) : rows.error ? (
              <EmptyState
                title={t("errors.loadTitle")}
                description={
                  coreErrorOf(rows.error).message ?? t("errors.load")
                }
                action={
                  <Button variant="outline" onClick={() => void rows.refetch()}>
                    {t("retry")}
                  </Button>
                }
              />
            ) : workspaceEmpty ? (
              <ContactsEmptyState
                offers={connectOffers}
                onAdd={() => setDialog({ kind: "add" })}
                onImport={() => setDialog({ kind: "import" })}
              />
            ) : contacts.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t("noMatchesTitle")}
                description={
                  filtered ? t("noMatches") : t(`emptyViews.${viewKey(view)}`)
                }
                action={
                  filtered ? (
                    <Button variant="outline" onClick={clearFilters}>
                      {t("clearFilters")}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="md:hidden">
                  <ContactsList
                    contacts={contacts}
                    onOpen={open}
                    hasMore={!!hasNextPage}
                    loadingMore={isFetchingNextPage}
                    onLoadMore={loadMore}
                    footer={t("showing", { shown: contacts.length, total })}
                  />
                </div>
                <div className="hidden md:block">
                  <ContactsGrid
                    contacts={contacts}
                    lists={lists.data ?? []}
                    selected={selected}
                    onSelectedChange={setSelected}
                    sort={sort}
                    direction={direction ?? defaultDirection(sort)}
                    onSort={handleSort}
                    onOpen={open}
                    onOrganization={changeOrganization}
                    onUpdate={update}
                    onImportance={setImportance}
                    hasMore={!!hasNextPage}
                    loadingMore={isFetchingNextPage}
                    onLoadMore={loadMore}
                    footer={t("showing", { shown: contacts.length, total })}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {openId ? (
        <ContactPanel
          key={openId}
          contactId={openId}
          lists={lists.data ?? []}
          teammates={teammates}
          onClose={() => void setOpenId(null)}
          onCloseAutoFocus={restoreFocus}
          onOpenContact={open}
          onMerge={(group) => setDialog({ kind: "merge", contacts: group })}
        />
      ) : null}
      {dialog?.kind === "add" ? (
        <AddContactDialog
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            setDialog(null);
            open(id);
          }}
          onOpenExisting={(id) => {
            setDialog(null);
            open(id);
          }}
        />
      ) : null}
      {dialog?.kind === "import" ? (
        <ImportContactsDialog onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "list" ? (
        <ContactListDialog
          list={dialog.list}
          onClose={() => setDialog(null)}
          onSaved={(list) => {
            setDialog(null);
            void refreshContacts(cache);
            if (!dialog.list) changeView(list.id);
          }}
        />
      ) : null}
      {dialog?.kind === "merge" ? (
        <MergeContactsDialog
          contacts={dialog.contacts}
          onClose={() => setDialog(null)}
          onMerged={(winner) => {
            setDialog(null);
            setSelected([]);
            toast.success(t("merged", { name: winner.name }));
            open(winner.id);
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
              {t("deleteList.title", {
                name: dialog?.kind === "deleteList" ? dialog.list.name : "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteList.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteList.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={(event) => {
                event.preventDefault();
                if (dialog?.kind === "deleteList") void deleteList(dialog.list);
              }}
            >
              {t("deleteList.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function viewKey(view: string): string {
  return isContactPreset(view) ? view : "list";
}
