"use client";
import type { Contact, ContactList, ContactStage } from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { Download, MoreHorizontal, UserPlus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback, useDeferredValue, useState } from "react";
import { toast } from "sonner";
import {
  CONTACT_SORTS,
  CONTACT_STAGES,
  type ContactSort,
  contactQuery,
  coreErrorOf,
  defaultDirection,
  isContactPreset,
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
import { Skeleton } from "@/components/ui/skeleton";
import { contactsService } from "@/lib/services/contacts.client";
import type { SokoBotConnectOffer } from "@/lib/soko-bot/connect-prompt";
import { AddContactDialog } from "./add-contact-dialog";
import { ContactListDialog } from "./contact-list-dialog";
import { ContactPanel } from "./contact-panel";
import { ContactsEmptyState } from "./contacts-empty-state";
import { ContactsGrid } from "./contacts-grid";
import { ContactsRail, ContactsViewPicker } from "./contacts-rail";
import { ContactsBulkBar, ContactsFilters } from "./contacts-toolbar";
import { ImportContactsDialog } from "./import-contacts-dialog";
import { MergeContactsDialog } from "./merge-contacts-dialog";
import { useContactUpdate } from "./use-contact-update";
import {
  CONTACT_LISTS_KEY,
  refreshContacts,
  useContactLists,
  useContactRows,
  useTeammates,
} from "./use-contacts-data";

type Dialog =
  | { kind: "add" }
  | { kind: "import" }
  | { kind: "list"; list?: ContactList }
  | { kind: "deleteList"; list: ContactList }
  | { kind: "merge"; contacts: Contact[] };

/** The Contacts tab: lists on the left, the grid, and the person panel. */
export function ContactsWorkspace({
  connectOffers,
}: {
  connectOffers: SokoBotConnectOffer[] | null;
}) {
  const t = useTranslations("App.Contacts");
  const cache = useQueryClient();
  const update = useContactUpdate();
  const [view, setView] = useQueryState(
    "list",
    parseAsString.withDefault("all"),
  );
  const [search, setSearch] = useQueryState("q", parseAsString.withDefault(""));
  const [stage, setStage] = useQueryState(
    "stage",
    parseAsStringLiteral(CONTACT_STAGES),
  );
  const [owner, setOwner] = useQueryState("owner");
  const [knownBy, setKnownBy] = useQueryState("knownBy");
  const [sort, setSort] = useQueryState(
    "sort",
    parseAsStringLiteral(CONTACT_SORTS).withDefault("updatedAt"),
  );
  const [direction, setDirection] = useQueryState(
    "dir",
    parseAsStringLiteral(["asc", "desc"] as const),
  );
  const [openId, setOpenId] = useQueryState("contact");
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [exporting, setExporting] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const { teammates } = useTeammates();
  const lists = useContactLists();
  const query = contactQuery({
    view,
    search: deferredSearch,
    stage,
    owner,
    knownBy,
    sort,
    direction: direction ?? defaultDirection(sort),
  });
  const rows = useContactRows(query);
  const contacts = rows.data?.pages.flatMap((page) => page.contacts) ?? [];
  const total = rows.data?.pages[0]?.total ?? 0;
  const viewList = lists.data?.find((list) => list.id === view) ?? null;
  const filtered = !!(search.trim() || stage || owner || knownBy);
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
    void setOpenId(id);
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
  function bulkUpdate(
    fields: Parameters<typeof update>[1],
    optimistic: Partial<Contact>,
  ) {
    const targets = selectedContacts;
    void Promise.all(
      targets.map((contact) => update(contact, fields, optimistic)),
    ).then((results) => {
      const saved = results.filter(Boolean).length;
      if (saved) toast.success(t("bulk.updated", { count: saved }));
      void refreshContacts(cache);
    });
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

  const heading = isContactPreset(view)
    ? t(`presets.${view}`)
    : (viewList?.name ?? t("presets.all"));
  const workspaceEmpty =
    !rows.isPending && total === 0 && view === "all" && !filtered;

  const rail = (
    <ContactsRail
      view={view}
      onViewChange={changeView}
      lists={lists.data ?? []}
      onNewList={() => setDialog({ kind: "list" })}
      onEditList={(list) => setDialog({ kind: "list", list })}
      onDeleteList={(list) => setDialog({ kind: "deleteList", list })}
      onImport={() => setDialog({ kind: "import" })}
    />
  );

  return (
    <div className="grid min-w-0 gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden md:block">
        <div className="sticky top-0">{rail}</div>
      </aside>
      <div className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl leading-tight font-semibold tracking-tight">
              {heading}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {viewList?.description ||
                (rows.isPending ? " " : t("count", { count: total }))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-10 md:h-8"
              loading={exporting}
              onClick={() => void handleExport()}
            >
              <Download aria-hidden className="size-4" />
              {t("toolbar.export")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="h-10 md:h-8"
              onClick={() => setDialog({ kind: "add" })}
            >
              <UserPlus aria-hidden className="size-4" />
              {t("toolbar.add")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("toolbar.more")}
                  className="size-10 md:size-8"
                >
                  <MoreHorizontal aria-hidden className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDialog({ kind: "import" })}>
                  {t("rail.import")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog({ kind: "list" })}>
                  {t("rail.newList")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="md:hidden">
          <ContactsViewPicker
            view={view}
            onViewChange={changeView}
            lists={lists.data ?? []}
            onNewList={() => setDialog({ kind: "list" })}
          />
        </div>
        {selected.length ? (
          <ContactsBulkBar
            count={selected.length}
            lists={lists.data ?? []}
            viewList={viewList?.kind === "manual" ? viewList : null}
            teammates={teammates}
            onAddToList={(list) =>
              void bulk(
                () => contactsService.changeMembers(list.id, { add: selected }),
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
            onStage={(next: ContactStage) => bulkUpdate({ stage: next }, {})}
            onOwner={(userId) =>
              bulkUpdate(
                { ownerUserId: userId },
                {
                  owner:
                    teammates.find((person) => person.id === userId) ?? null,
                },
              )
            }
            onMerge={() =>
              setDialog({ kind: "merge", contacts: selectedContacts })
            }
            onClear={() => setSelected([])}
          />
        ) : (
          <ContactsFilters
            search={search}
            onSearch={(value) => {
              void setSearch(value || null);
              setSelected([]);
            }}
            stage={stage}
            onStage={(value) => void setStage(value)}
            owner={owner}
            onOwner={(value) => void setOwner(value)}
            knownBy={knownBy}
            onKnownBy={(value) => void setKnownBy(value)}
            teammates={teammates}
          />
        )}
        <div className="bg-card-background min-w-0 overflow-hidden rounded-xl border">
          {rows.isPending ? (
            <div className="grid gap-2 p-4" role="status">
              <span className="sr-only">{t("loading")}</span>
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : rows.error ? (
            <EmptyState
              title={t("errors.loadTitle")}
              description={coreErrorOf(rows.error).message ?? t("errors.load")}
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
                  <Button
                    variant="outline"
                    onClick={() => {
                      void setSearch(null);
                      void setStage(null);
                      void setOwner(null);
                      void setKnownBy(null);
                    }}
                  >
                    {t("clearFilters")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ContactsGrid
              contacts={contacts}
              lists={lists.data ?? []}
              teammates={teammates}
              selected={selected}
              onSelectedChange={setSelected}
              sort={sort}
              direction={direction ?? defaultDirection(sort)}
              onSort={handleSort}
              onOpen={open}
              onUpdate={update}
              hasMore={!!hasNextPage}
              loadingMore={isFetchingNextPage}
              onLoadMore={loadMore}
              footer={t("showing", { shown: contacts.length, total })}
            />
          )}
        </div>
      </div>

      {openId ? (
        <ContactPanel
          key={openId}
          contactId={openId}
          lists={lists.data ?? []}
          teammates={teammates}
          onClose={() => void setOpenId(null)}
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
