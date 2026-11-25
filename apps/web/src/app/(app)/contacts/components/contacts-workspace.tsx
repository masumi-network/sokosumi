"use client";
import type {
  Contact,
  ContactChannelSource,
  ContactKind,
  ContactList,
  ContactReplyState,
  ContactStage,
  PostContactsStageUndoData,
} from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { GitMerge, Users } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback, useRef, useState } from "react";
import { type ExternalToast, toast } from "sonner";
import { useDebounce } from "use-debounce";
import {
  CONTACT_CHANNEL_SOURCES,
  CONTACT_KINDS,
  CONTACT_REPLY_STATES,
  CONTACT_SORTS,
  CONTACT_STAGES,
  type ContactSort,
  contactEmails,
  contactQuery,
  coreErrorOf,
  defaultDirection,
  isContactPreset,
  matchesContactSearch,
  replaceVisibleSelection,
  smartFilterOf,
} from "@/app/contacts/contacts-view";
import { FundraisingLink } from "@/app/fundraising/components/fundraising-link";
import { EmptyState } from "@/components/common/empty-state";
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
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { getEnvPublicConfig } from "@/config/env.public";
import { contactsService } from "@/lib/services/contacts.client";
import type { ContactsSyncState } from "@/lib/soko-bot/connect-prompt";
import { cn } from "@/lib/utils";
import { AddContactDialog } from "./add-contact-dialog";
import { CompaniesView } from "./companies-view";
import { CompanyHeader } from "./company-header";
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
import { ContactsViewMenus } from "./contacts-views-bar";
import { ContactsWorkspaceHeader } from "./contacts-workspace-header";
import { DuplicatesDialog } from "./duplicates-dialog";
import { ImportContactsDialog } from "./import-contacts-dialog";
import { ImportLinkedInDialog } from "./import-linkedin-dialog";
import { ListOverview } from "./list-overview";
import { ListSuggestions } from "./list-suggestions";
import { MergeContactsDialog } from "./merge-contacts-dialog";
import { useContactArchive } from "./use-contact-archive";
import { useContactUpdate, useImportanceUpdate } from "./use-contact-update";
import {
  CONTACT_DUPLICATES_KEY,
  CONTACT_LISTS_KEY,
  DUPLICATE_GROUP_LIMIT,
  refreshContacts,
  useContactDuplicates,
  useContactLists,
  useContactMap,
  useContactOrganizations,
  useContactRows,
  useTeammates,
} from "./use-contacts-data";

// The map and its world outline load only when someone opens it.
const ContactsMap = dynamic(
  () => import("./contacts-map").then((module) => module.ContactsMap),
  { ssr: false },
);

type Dialog =
  | { kind: "add" }
  | { kind: "import" }
  | { kind: "linkedin" }
  | { kind: "list"; list?: ContactList }
  | { kind: "deleteList"; list: ContactList }
  | { kind: "duplicates" }
  /** `fromDuplicates` returns to the duplicates list when the merge ends. */
  | { kind: "merge"; contacts: Contact[]; fromDuplicates?: boolean };

type StageUndo = NonNullable<PostContactsStageUndoData["body"]>["contacts"];

/** The Contacts tab: views and companies on top, the grid, and the person panel. */
export function ContactsWorkspace({
  sync,
}: {
  sync: ContactsSyncState | null;
}) {
  const t = useTranslations("App.Contacts");
  const cache = useQueryClient();
  const update = useContactUpdate();
  const setImportance = useImportanceUpdate();
  const restore = useContactArchive({ restore: true });
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
  const [source, setSource] = useQueryState(
    "source",
    parseAsStringLiteral(CONTACT_CHANNEL_SOURCES),
  );
  const [sort, setSort] = useQueryState(
    "sort",
    parseAsStringLiteral(CONTACT_SORTS).withDefault("lastContactAt"),
  );
  const [direction, setDirection] = useQueryState(
    "dir",
    parseAsStringLiteral(["asc", "desc"] as const),
  );
  const [openId, setOpenId] = useQueryState("contact");
  const [urlLayout, setLayout] = useQueryState(
    "layout",
    parseAsStringLiteral(["map", "companies"] as const),
  );
  // The archive is a plain list: the live layouts never show archived people,
  // and a link that names both opens the archive.
  const archived = view === "archived";
  const layout = archived ? null : urlLayout;
  const [selectedIds, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Core searches once per pause in typing; meanwhile every keystroke filters
  // the rows already on screen, so the table answers as you type.
  const [debouncedSearch] = useDebounce(
    search,
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  const { teammates } = useTeammates();
  const lists = useContactLists();
  const duplicates = useContactDuplicates();
  const duplicateGroups = duplicates.data ?? [];
  const duplicatesCapped = duplicateGroups.length >= DUPLICATE_GROUP_LIMIT;
  const organizations = useContactOrganizations(debouncedCompanySearch);
  const filters: ContactFilters = { stage, replyState, kind, knownBy, source };
  const query = contactQuery({
    view,
    company,
    search: debouncedSearch,
    ...filters,
    sort,
    direction: direction ?? defaultDirection(sort),
  });
  const rows = useContactRows(query);
  const smartFilter = smartFilterOf(
    {
      view,
      company,
      search: debouncedSearch,
      ...filters,
      sort,
      direction: direction ?? defaultDirection(sort),
    },
    lists.data?.find((list) => list.id === view)?.kind,
  );
  // Started here, not in the lazy map, so it runs beside the rows request.
  useContactMap(query, layout === "map");
  const showCompanies = layout === "companies";
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
    source: (value) => setSource(value as ContactChannelSource | null),
  };
  function clearFilters() {
    void setSearch(null);
    void setCompany(null);
    for (const set of Object.values(setFilter)) void set(null);
  }
  const selection = new Set(selectedIds);
  const selectedContacts = contacts.filter((contact) =>
    selection.has(contact.id),
  );
  const selected = selectedContacts.map((contact) => contact.id);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = rows;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  function changeView(next: string) {
    void setView(next === "all" ? null : next);
    if (next === "archived") void setLayout(null);
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

  async function bulk<T>(
    action: () => Promise<T>,
    done: string | ((result: T) => [string, ExternalToast?]),
  ) {
    try {
      const result = await action();
      if (typeof done === "string") toast.success(done);
      else toast.success(...done(result));
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("errors.saveFailed"));
    } finally {
      await refreshContacts(cache);
    }
  }
  function undoToast(undo: StageUndo): ExternalToast {
    return {
      // Undo is the only way back for up to 500 contacts: it stays until the
      // reader uses or closes it, never on a timer.
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      action: { label: t("bulk.undo"), onClick: () => void undoStage(undo) },
    };
  }
  async function undoStage(undo: StageUndo) {
    try {
      const { restored, skipped } = await contactsService.undoStage(undo);
      toast.success(
        skipped
          ? t("bulk.stageUndonePartly", {
              count: restored,
              total: undo.length,
            })
          : t("bulk.stageUndone", { count: restored }),
      );
    } catch (error) {
      // Core skips contacts already restored, so offering Undo again is safe.
      toast.error(
        coreErrorOf(error).message ?? t("errors.saveFailed"),
        undoToast(undo),
      );
    } finally {
      await refreshContacts(cache);
    }
  }
  async function handleCopyEmails() {
    const { emails, skipped } = contactEmails(selectedContacts);
    if (!emails.length) {
      toast.error(t("bulk.noEmails"));
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(", "));
    } catch {
      toast.error(t("bulk.copyFailed"));
      return;
    }
    toast.success(t("bulk.copiedEmails", { count: emails.length }), {
      description: skipped
        ? t("bulk.skippedNoEmail", { count: skipped })
        : undefined,
    });
  }
  async function markNotSame(group: Contact[]) {
    try {
      await contactsService.notDuplicates(group.map((contact) => contact.id));
      toast.success(t("notSame", { count: group.length }));
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("errors.saveFailed"));
    } finally {
      await cache.invalidateQueries({ queryKey: CONTACT_DUPLICATES_KEY });
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
        <ContactsWorkspaceHeader
          searchField={
            showCompanies ? undefined : (
              <PageSearchField
                inHeader
                aria-label={t("toolbar.search")}
                placeholder={t("toolbar.searchPlaceholder")}
                value={search}
                maxLength={200}
                onValueChange={(value) => void setSearch(value || null)}
              />
            )
          }
          archived={archived}
          view={view}
          layout={layout}
          query={query}
          changeView={changeView}
          onLayout={(next) => {
            void setLayout(next);
            setSelected([]);
          }}
          onDialog={(kind) => setDialog({ kind })}
        />
        {showCompanies ? (
          <CompaniesView
            onOpenCompany={(name) => {
              void setLayout(null);
              changeOrganization(name);
            }}
          />
        ) : (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {selected.length ? (
                <ContactsBulkBar
                  count={selected.length}
                  lists={lists.data ?? []}
                  viewList={viewList?.kind === "manual" ? viewList : null}
                  onSetStage={(next) =>
                    void bulk(
                      async () => {
                        const result = await contactsService.setStage(
                          selected,
                          next,
                        );
                        // A stage filter or a smart list can drop the changed
                        // rows from view; keeping them selected would act on
                        // rows nobody sees.
                        setSelected([]);
                        return result;
                      },
                      ({ undo }) => [
                        t("bulk.stageSet", {
                          count: selected.length,
                          stage: t(`stages.${next}`),
                        }),
                        undo.length ? undoToast(undo) : undefined,
                      ],
                    )
                  }
                  onAddToList={(list) =>
                    void bulk(
                      () =>
                        contactsService.changeMembers(list.id, {
                          add: selected,
                        }),
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
                  onCopyEmails={() => void handleCopyEmails()}
                  onMerge={() =>
                    setDialog({ kind: "merge", contacts: selectedContacts })
                  }
                  onClear={() => setSelected([])}
                />
              ) : (
                <ContactsFilterBar
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
              <span className="ms-auto flex shrink-0 items-center gap-2">
                {viewList?.name.trim().toLowerCase() === "investors" ? (
                  <FundraisingLink className="h-10 md:h-8" />
                ) : null}
                {duplicateGroups.length ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-10 md:h-8"
                    onClick={() => setDialog({ kind: "duplicates" })}
                  >
                    <GitMerge aria-hidden className="size-4" />
                    {t(duplicatesCapped ? "duplicatesMore" : "duplicates", {
                      count: duplicateGroups.length,
                    })}
                  </Button>
                ) : null}
                <span className="text-muted-foreground text-sm tabular-nums">
                  {rows.isPending ? null : t("count", { count: total })}
                </span>
              </span>
            </div>
            {viewList?.description ? (
              <p className="text-muted-foreground -mt-1 truncate text-sm">
                {viewList.description}
              </p>
            ) : null}
            {viewList && layout !== "map" ? (
              <ListOverview
                query={query}
                onShowMap={() => {
                  void setLayout("map");
                  setSelected([]);
                }}
                onCompany={changeOrganization}
              />
            ) : null}
            {viewList?.kind === "manual" ? (
              <ListSuggestions key={viewList.id} list={viewList} />
            ) : null}
            {company ? (
              <CompanyHeader
                key={company}
                name={company}
                onOpenContact={(id) => void setOpenId(id)}
              />
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
                      <Button
                        variant="outline"
                        onClick={() => void rows.refetch()}
                      >
                        {t("retry")}
                      </Button>
                    }
                  />
                ) : workspaceEmpty ? (
                  <ContactsEmptyState
                    sync={sync}
                    onAdd={() => setDialog({ kind: "add" })}
                    onImport={() => setDialog({ kind: "import" })}
                  />
                ) : layout === "map" ? (
                  <ContactsMap
                    query={query}
                    filtered={filtered}
                    onClearFilters={clearFilters}
                    onOpen={open}
                  />
                ) : contacts.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title={t("noMatchesTitle")}
                    description={
                      filtered
                        ? t("noMatches")
                        : t(`emptyViews.${viewKey(view)}`)
                    }
                    action={
                      filtered ? (
                        <Button variant="outline" onClick={clearFilters}>
                          {t("clearFilters")}
                        </Button>
                      ) : undefined
                    }
                  />
                ) : archived ? (
                  // Archived people are read-only: no editable grid, no bulk
                  // actions, one Restore per row.
                  <ContactsList
                    contacts={contacts}
                    onOpen={open}
                    onRestore={(contact) => void restore(contact, () => {})}
                    hasMore={!!hasNextPage}
                    loadingMore={isFetchingNextPage}
                    onLoadMore={loadMore}
                    footer={t("showing", { shown: contacts.length, total })}
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
                        onSelectedChange={(next) =>
                          setSelected((current) =>
                            replaceVisibleSelection(current, selected, next),
                          )
                        }
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
                        search={search}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
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
          listId={viewList?.kind === "manual" ? viewList.id : undefined}
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
      {dialog?.kind === "linkedin" ? (
        <ImportLinkedInDialog onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "list" ? (
        <ContactListDialog
          list={dialog.list}
          smartFilter={smartFilter}
          onClose={() => setDialog(null)}
          onSaved={(list) => {
            setDialog(null);
            void refreshContacts(cache);
            if (!dialog.list) changeView(list.id);
          }}
        />
      ) : null}
      {dialog?.kind === "duplicates" ? (
        <DuplicatesDialog
          groups={duplicateGroups}
          capped={duplicatesCapped}
          onMerge={(group) =>
            setDialog({ kind: "merge", contacts: group, fromDuplicates: true })
          }
          onNotSame={(group) => void markNotSame(group)}
          onOpenContact={(id) => {
            setDialog(null);
            open(id);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "merge" ? (
        <MergeContactsDialog
          contacts={dialog.contacts}
          onClose={() =>
            setDialog(dialog.fromDuplicates ? { kind: "duplicates" } : null)
          }
          onMerged={(winner) => {
            toast.success(t("merged", { name: winner.name }));
            setSelected([]);
            if (dialog.fromDuplicates) {
              setDialog({ kind: "duplicates" });
              return;
            }
            setDialog(null);
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
