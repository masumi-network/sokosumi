"use client";

import {
  Bookmark,
  Loader2,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import { DriveBulkCategoryPicker } from "@/app/drive/components/drive-bulk-category-picker";
import { DriveFileFilters } from "@/app/drive/components/drive-file-filters";
import { DriveFileRow } from "@/app/drive/components/drive-file-row";
import { DriveFileViewer } from "@/app/drive/components/drive-file-viewer";
import {
  childFolders,
  DriveFolderNav,
} from "@/app/drive/components/drive-folder-nav";
import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type {
  FileCollection,
  FileResource,
  FileSearchMeta,
  WorkspaceLabel,
} from "@/lib/clients/generated/core";
import type { FilesViewMode } from "@/lib/ui-preferences/files-view-mode";
import { cn } from "@/lib/utils";
import {
  applyMetadataBatch,
  countActiveFileFilters,
  createFileCollection,
  createSelectionToken,
  decideSuggestion,
  deleteFileCollection,
  EMPTY_FILE_FILTERS,
  type FileSearchFilterState,
  type FileStore,
  fetchFileCollections,
  fetchFileSearchPage,
  fetchWorkspaceFolders,
  fetchWorkspaceLabels,
  updateFileCollection,
} from "@/lib/utils/file-search.client";
import { mergeLoadedFilePage } from "./drive-all-files-panel.utils";

/**
 * All files: one search field over filenames, extracted text and confirmed
 * metadata, with filters, saved collections and bounded bulk editing.
 *
 * Three behaviours here are deliberate rather than incidental:
 *
 * - A superseded response never lands. Each request carries a sequence
 *   number and an abort signal, so a fast second keystroke cannot be
 *   overwritten by a slow first one.
 * - "Select all" means the result window the reader was shown, and the
 *   button says so. There is no selection of unseen matches.
 * - Counts describe this bounded window, never the corpus. When a retrieval
 *   budget was reached the list says more may match instead of inventing a
 *   total.
 */

const SEARCH_DEBOUNCE_MS = 250;

/**
 * One surface, two states: no query and no filter is browsing, anything else is
 * searching.
 *
 * Browsing shows the current folder — its folders and the files filed directly
 * in it. Searching shows results from the whole workspace and leaves the folder
 * out, so a query typed inside a folder is not silently limited to it. Clearing
 * the query returns to the folder the reader was in.
 */
function isBrowsing(query: string, filters: FileSearchFilterState): boolean {
  return (
    query.trim().length === 0 &&
    countActiveFileFilters({ ...filters, folder: "" }) === 0
  );
}

/** What the request should carry for the state the reader is in. */
function requestFor(query: string, filters: FileSearchFilterState) {
  const browsing = isBrowsing(query, filters);
  return {
    browsing,
    filters: browsing ? filters : { ...filters, folder: "" },
    sortBy: browsing
      ? ("name" as const)
      : query.trim()
        ? ("relevance" as const)
        : ("modified" as const),
    sortOrder: browsing ? ("asc" as const) : ("desc" as const),
  };
}

/** Types offered as one-tap chips; the popover still carries them all. */
const TYPE_CHIPS = ["document", "image", "data", "video", "audio"] as const;

export interface DriveAllFilesPanelProps {
  store: FileStore;
  viewMode: FilesViewMode;
  isMobile: boolean;
  /** The `q` the reader arrived with, from global search's "See all files". */
  initialQuery?: string;
  /**
   * The folder a `?folder=` deep link asked for, pre-applied as a facet.
   *
   * Those links used to open a folder browser that owned the whole page. They
   * still work, and now they narrow the catalog instead of replacing it.
   */
  initialFolder?: string;
  /**
   * The folder facet changed.
   *
   * The page head's folder actions — rename, move, delete — act on whichever
   * folder is narrowing the list, and they are the only surface left that can:
   * they used to live on the folder cards this catalog replaced. The page needs
   * to know which folder that is, and this is the whole of what it needs.
   */
  onFolderChange?: (folder: string) => void;
  /**
   * Controls for the folder the reader is standing in, shown beside the trail.
   * The page owns rename, move and delete, so it passes them in.
   */
  folderActions?: ReactNode;
  /**
   * Bumped when the page changed the files behind this list — an upload, a
   * folder rename, a delete.
   *
   * The catalog reads the search index and the page's own mutations go through
   * the blob store, so nothing else connects the two. Without it an upload on
   * this tab landed in the store and appeared nowhere.
   */
  reloadToken?: number;
}

interface SearchState {
  items: FileResource[];
  meta: FileSearchMeta | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /**
   * The last page replaced this list because its window had expired.
   *
   * Shown beside Load more, and cleared by anything that starts a fresh
   * list, so the notice describes the list currently on screen rather
   * than lingering over a later one.
   */
  restarted: boolean;
}

export function DriveAllFilesPanel({
  store,
  viewMode,
  isMobile,
  initialQuery = "",
  initialFolder = "",
  onFolderChange,
  folderActions,
  reloadToken = 0,
}: DriveAllFilesPanelProps) {
  const t = useTranslations("App.Drive.Files");

  // "See all files" in global search navigates to `/drive?view=all&q=…`.
  // The panel used to start empty and drop it, so the reader arrived at an
  // unfiltered list and had to retype what they had just typed.
  const [query, setQuery] = useState(initialQuery);
  const [appliedQuery, setAppliedQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<FileSearchFilterState>({
    ...EMPTY_FILE_FILTERS,
    folder: initialFolder,
  });
  const [folders, setFolders] = useState<string[]>([]);
  const [labels, setLabels] = useState<WorkspaceLabel[]>([]);
  const categories = labels.filter((label) => label.kind === "CATEGORY");
  const [labelsState, setLabelsState] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [collections, setCollections] = useState<FileCollection[]>([]);
  /**
   * Collections load separately from results, so they get their own three
   * states. "Loading" and "failed" are distinct from "you have none" — the
   * ones that get skipped and then found in a browser.
   */
  const [collectionsState, setCollectionsState] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    null,
  );
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  /**
   * The file the reader opened in the viewer, if any.
   *
   * The name and type ride along with the id, so the viewer can choose how to
   * show it on the first frame.
   */
  const [openFile, setOpenFile] = useState<{
    id: string;
    displayName: string;
    mimeType: string | null;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionToken, setSelectionToken] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [state, setState] = useState<SearchState>({
    items: [],
    meta: null,
    loading: true,
    loadingMore: false,
    error: null,
    restarted: false,
  });

  /**
   * The one way filters change, so a folder change cannot reach the list
   * without the page head hearing about it.
   *
   * Four things set filters — the filter sheet's Apply, a facet chip's X, Clear
   * filters, and loading a collection — and the folder actions in the page head
   * have to follow all four, not the one that was remembered.
   */
  const applyFilters = useCallback(
    (next: FileSearchFilterState) => {
      setFilters((current) => {
        if (current.folder !== next.folder) onFolderChange?.(next.folder);
        return next;
      });
    },
    [onFolderChange],
  );

  const sequenceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);

  /**
   * A stable identity for the active store, used as an effect dependency
   * so a workspace switch re-runs the load.
   *
   * Not rendered. It used to also be written into an `sr-only` span with
   * a `data-testid`, which hides it from sight and not from assistive
   * technology — so a screen reader read the organisation id aloud as
   * part of the All files panel. Nothing in the repository ever
   * referenced that test id: it was a hook that shipped without its test.
   */
  const storeKey = `${store.scope}:${store.organizationId ?? ""}`;

  const runSearch = useCallback(
    async (input: {
      query: string;
      filters: FileSearchFilterState;
      /**
       * Keep whatever is selected, narrowed to rows that came back.
       *
       * The refresh after a partial bulk edit deliberately leaves the failed
       * rows selected so the reader can retry exactly those — and then this
       * function cleared them a tick later, defeating the comment above it.
       */
      keepSelection?: boolean;
    }) => {
      const sequence = sequenceRef.current + 1;
      sequenceRef.current = sequence;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((current) => ({ ...current, loading: true, error: null }));

      try {
        const request = requestFor(input.query, input.filters);
        const page = await fetchFileSearchPage({
          store,
          query: input.query,
          filters: request.filters,
          directOnly: request.browsing,
          sortBy: request.sortBy,
          sortOrder: request.sortOrder,
          signal: controller.signal,
        });
        // A response from a superseded request is dropped, not rendered.
        if (sequence !== sequenceRef.current) return;
        setState({
          items: page.items,
          meta: page.search,
          loading: false,
          loadingMore: false,
          error: null,
          // A search the reader just asked for is not a refreshed list,
          // even when the server rebuilt a window to serve it.
          restarted: false,
        });
        if (input.keepSelection) {
          // A row that is no longer in the result set cannot be retried, so
          // it does not stay selected either.
          setSelectedIds((current) =>
            current.filter((id) => page.items.some((item) => item.id === id)),
          );
        } else {
          setSelectedIds([]);
          setSelectionToken(null);
        }
      } catch {
        if (controller.signal.aborted) return;
        if (sequence !== sequenceRef.current) return;
        setState((current) => ({
          ...current,
          loading: false,
          loadingMore: false,
          error: t("searchError"),
        }));
      }
    },
    [store, t],
  );

  /**
   * A folder arriving from outside: a deep link, Back, or the page head having
   * just renamed or deleted the folder this list is narrowed to.
   *
   * `setFilters` and not `applyFilters`: the page is where this came from, so
   * telling it again would be an echo.
   */
  useEffect(() => {
    setFilters((current) =>
      current.folder === initialFolder
        ? current
        : { ...current, folder: initialFolder },
    );
  }, [initialFolder]);

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setAppliedQuery(value);
  }, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    void runSearch({ query: appliedQuery, filters });
    // `reloadToken` is a signal, not an input: the same query and filters run
    // again because the files under them changed.
  }, [appliedQuery, filters, runSearch, reloadToken]);

  /**
   * Two loads, reported separately, because they fail separately.
   *
   * These used to share a `Promise.all` and one `catch` that set
   * `collectionsState: "failed"`. So a labels outage was reported to the
   * reader as "collections unavailable", and Retry — which re-fetched
   * collections only — made the message disappear while the vocabulary was
   * still empty. The filter sheet then offered no categories and no tags,
   * and the reader had just been shown that everything recovered. A retry
   * that appears to work while half the data is still missing is worse
   * than an error that stays on screen.
   */
  useEffect(() => {
    const controller = new AbortController();
    setLabelsState("loading");
    setCollectionsState("loading");

    void (async () => {
      const [labelResult, collectionResult, folderResult] =
        await Promise.allSettled([
          fetchWorkspaceLabels({ store, signal: controller.signal }),
          fetchFileCollections({ store, signal: controller.signal }),
          fetchWorkspaceFolders({ store, signal: controller.signal }),
        ]);
      if (controller.signal.aborted) return;

      // No state of its own. A folder facet the reader cannot see is a filter
      // they do not miss, and the search box above it is the better tool
      // anyway — so a failure here is silent rather than an error about
      // something they were not looking for.
      setFolders(folderResult.status === "fulfilled" ? folderResult.value : []);

      if (labelResult.status === "fulfilled") {
        setLabels(labelResult.value);
        setLabelsState("ready");
      } else {
        // Vocabulary is an aid, not the list: a failure here must not empty
        // the results the reader came for.
        setLabelsState("failed");
      }

      if (collectionResult.status === "fulfilled") {
        setCollections(collectionResult.value);
        setCollectionsState("ready");
      } else {
        setCollectionsState("failed");
      }
    })();

    return () => controller.abort();
  }, [store]);

  // Switching workspace is a different scope: drop everything rather than
  // letting one store's rows linger under another store's header.
  useEffect(() => {
    setSelectedIds([]);
    setSelectionToken(null);
    setState({
      items: [],
      meta: null,
      loading: true,
      loadingMore: false,
      error: null,
      restarted: false,
    });
  }, [storeKey]);

  async function loadMore() {
    const cursor = state.meta?.nextCursor;
    if (!cursor || state.loadingMore) return;

    setState((current) => ({ ...current, loadingMore: true }));
    try {
      const request = requestFor(appliedQuery, filters);
      const page = await fetchFileSearchPage({
        store,
        query: appliedQuery,
        filters: request.filters,
        directOnly: request.browsing,
        sortBy: request.sortBy,
        sortOrder: request.sortOrder,
        cursor,
      });
      setState((current) => {
        const merged = mergeLoadedFilePage(current.items, page);
        return {
          items: merged.items,
          meta: merged.meta,
          loading: false,
          loadingMore: false,
          error: null,
          restarted: merged.restarted,
        };
      });
    } catch {
      setState((current) => ({
        ...current,
        loadingMore: false,
        error: t("searchError"),
      }));
    }
  }

  function toggleRow(index: number, id: string, shiftKey: boolean) {
    setSelectedIds((current) => {
      if (shiftKey && lastSelectedIndexRef.current !== null) {
        const [from, to] = [lastSelectedIndexRef.current, index].sort(
          (a, b) => a - b,
        );
        const range = state.items.slice(from, to + 1).map((item) => item.id);
        return [...new Set([...current, ...range])];
      }
      return current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id];
    });
    lastSelectedIndexRef.current = index;
    setSelectionToken(null);
  }

  function selectThisPage() {
    setSelectedIds(state.items.map((item) => item.id));
    setSelectionToken(null);
  }

  async function selectWholeWindow() {
    const cursor = state.meta?.nextCursor;
    if (!cursor) {
      selectThisPage();
      return;
    }
    try {
      const token = await createSelectionToken({
        store,
        windowCursor: cursor,
      });
      setSelectionToken(token.token);
      toast.success(t("bulkWindowSelected", { count: token.count }));
    } catch {
      toast.error(t("bulkSelectionExpired"));
    }
  }

  async function applyBulk(input: {
    addTagLabelIds?: string[];
    removeTagLabelIds?: string[];
    categoryLabelId?: string | null;
  }) {
    if (selectedIds.length === 0 && !selectionToken) return;
    setBulkBusy(true);
    try {
      const byId = new Map(state.items.map((item) => [item.id, item]));
      const result = await applyMetadataBatch({
        store,
        ...(selectionToken
          ? { selectionToken }
          : {
              resourceIds: selectedIds,
              expectedRevisions: selectedIds.flatMap((id) => {
                const item = byId.get(id);
                return item
                  ? [
                      {
                        resourceId: id,
                        metadataRevision: item.metadataRevision,
                      },
                    ]
                  : [];
              }),
            }),
        ...input,
      });

      if (result.revisedCount !== null) {
        toast.warning(t("bulkWindowChanged", { count: result.revisedCount }));
        setSelectionToken(null);
        return;
      }

      const failed = result.outcomes.filter(
        (outcome) => outcome.status !== "applied",
      );
      const applied = result.outcomes.length - failed.length;

      if (failed.length === 0) {
        toast.success(t("bulkApplied", { count: applied }));
        setSelectedIds([]);
      } else {
        // Keep the rows that failed selected so the reader can retry exactly
        // those, and say plainly how the batch split.
        toast.warning(t("bulkPartial", { applied, failed: failed.length }));
        setSelectedIds(failed.map((outcome) => outcome.resourceId));
      }
      setSelectionToken(null);
      await runSearch({ query: appliedQuery, filters, keepSelection: true });
    } catch {
      toast.error(t("bulkError"));
    } finally {
      setBulkBusy(false);
    }
  }

  /** What a collection stores: the filters, plus the query that shaped them. */
  function currentDefinition(
    applied: FileSearchFilterState = filters,
  ): Record<string, unknown> {
    return { ...applied, query: appliedQuery };
  }

  /**
   * Take one label off one row, and offer the way back in the same breath.
   *
   * A dismissal is two writes: the label is rejected, and a tombstone bars the
   * model from proposing it again. The only code that ever cleared that
   * tombstone was the manual metadata edit, which is gone — so without the
   * Undo below, a misclick here was permanent and silent. The toast is the
   * only place the reader is still looking when it matters.
   */
  async function dismissLabel(item: FileResource, labelId: string) {
    let restore: (() => Promise<void>) | null = null;
    try {
      const updated = await decideSuggestion({
        store,
        resourceId: item.id,
        suggestionId: labelId,
        decision: "reject",
        expectedMetadataRevision: item.metadataRevision,
      });
      restore = async () => {
        await decideSuggestion({
          store,
          resourceId: item.id,
          suggestionId: labelId,
          decision: "restore",
          // The revision the dismissal produced, not the one it consumed.
          expectedMetadataRevision: updated.metadataRevision,
        });
        await runSearch({ query: appliedQuery, filters, keepSelection: true });
      };
      setState((current) => ({
        ...current,
        items: current.items.map((row) => (row.id === item.id ? updated : row)),
      }));
    } catch {
      toast.error(t("tagRemoveFailed"));
      return;
    }

    toast.success(t("tagRemoved"), {
      action: {
        label: t("undo"),
        onClick: () => {
          void restore?.().catch(() => toast.error(t("tagRestoreFailed")));
        },
      },
    });
  }

  async function reloadCollections() {
    // "loading" first, so pressing Retry says something immediately rather
    // than looking inert until the request resolves.
    setCollectionsState("loading");
    try {
      setCollections(await fetchFileCollections({ store }));
      setCollectionsState("ready");
    } catch {
      setCollectionsState("failed");
    }
  }

  async function reloadLabels() {
    setLabelsState("loading");
    try {
      setLabels(await fetchWorkspaceLabels({ store }));
      setLabelsState("ready");
    } catch {
      setLabelsState("failed");
    }
  }

  async function saveCollection(applied: FileSearchFilterState = filters) {
    const name = window.prompt(t("collectionNamePrompt"))?.trim();
    if (!name) return;

    setCollectionBusy(true);
    try {
      // The same `store` the list uses. Saving into one scope and listing
      // from another is how an author cannot see what they just saved.
      const created = await createFileCollection({
        store,
        name,
        // Passed in, not read back from state: the filter footer applies its
        // draft and saves in one gesture, and `filters` has not caught up yet.
        definition: currentDefinition(applied),
      });
      setActiveCollectionId(created.id);
      await reloadCollections();
      toast.success(t("collectionSaved", { name }));
    } catch {
      toast.error(t("collectionSaveFailed"));
    } finally {
      setCollectionBusy(false);
    }
  }

  async function resaveCollection(collection: FileCollection) {
    setCollectionBusy(true);
    try {
      await updateFileCollection({
        store,
        collectionId: collection.id,
        definition: currentDefinition(),
      });
      await reloadCollections();
      toast.success(t("collectionUpdated", { name: collection.name }));
    } catch {
      toast.error(t("collectionSaveFailed"));
    } finally {
      setCollectionBusy(false);
    }
  }

  async function renameCollection(collection: FileCollection) {
    const name = window
      .prompt(t("collectionNamePrompt"), collection.name)
      ?.trim();
    if (!name || name === collection.name) return;

    setCollectionBusy(true);
    try {
      await updateFileCollection({ store, collectionId: collection.id, name });
      await reloadCollections();
    } catch {
      toast.error(t("collectionSaveFailed"));
    } finally {
      setCollectionBusy(false);
    }
  }

  async function removeCollection(collection: FileCollection) {
    setCollectionBusy(true);
    try {
      await deleteFileCollection({ store, collectionId: collection.id });
      if (activeCollectionId === collection.id) setActiveCollectionId(null);
      await reloadCollections();
    } catch {
      toast.error(t("collectionDeleteFailed"));
    } finally {
      setCollectionBusy(false);
    }
  }

  // The folder is the trail's job, not a filter chip's, so it does not count.
  const activeFilterCount = countActiveFileFilters({ ...filters, folder: "" });
  const labelName = (id: string) =>
    labels.find((label) => label.id === id)?.displayName ?? id;

  /**
   * What is narrowing the list right now, each with the way to turn it off.
   *
   * One line, and absent entirely when nothing is applied. The page used to
   * carry a collections shelf, a result-window count and a bulk control in
   * this space whether or not the reader had done anything, so the first file
   * row sat below the fold on a list of ten files.
   */
  const appliedFacets: { key: string; label: string; remove: () => void }[] = [
    ...filters.categoryLabelIds.map((id) => ({
      key: `category:${id}`,
      label: labelName(id),
      remove: () =>
        setFilters((current) => ({
          ...current,
          categoryLabelIds: current.categoryLabelIds.filter(
            (entry) => entry !== id,
          ),
        })),
    })),
    ...filters.tagLabelIds.map((id) => ({
      key: `tag:${id}`,
      label: labelName(id),
      remove: () =>
        setFilters((current) => ({
          ...current,
          tagLabelIds: current.tagLabelIds.filter((entry) => entry !== id),
        })),
    })),
    ...filters.sourceKinds.map((kind) => ({
      key: `source:${kind}`,
      label: t(`source.${kind}` as "source.DRIVE_UPLOAD"),
      remove: () =>
        setFilters((current) => ({
          ...current,
          sourceKinds: current.sourceKinds.filter((entry) => entry !== kind),
        })),
    })),
    ...filters.extractionStates.map((state) => ({
      key: `status:${state}`,
      label: t(`status.${state}` as "status.INDEXED"),
      remove: () =>
        setFilters((current) => ({
          ...current,
          extractionStates: current.extractionStates.filter(
            (entry) => entry !== state,
          ),
        })),
    })),
  ];

  const browsing = isBrowsing(appliedQuery, filters);
  const selectionCount = selectionToken
    ? (state.meta?.windowCount ?? selectedIds.length)
    : selectedIds.length;

  return (
    <div className="flex flex-col gap-4" data-testid="drive-all-files">
      <DriveFileViewer
        file={openFile}
        store={store}
        onClose={() => setOpenFile(null)}
      />

      <form
        role="search"
        className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          debouncedSearch.cancel();
          setAppliedQuery(query);
        }}
      >
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={query}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            maxLength={1000}
            onChange={(event) => {
              setQuery(event.target.value);
              debouncedSearch(event.target.value);
            }}
            // The browser's own clear control is inconsistent and hidden in
            // some engines; ours is always the same and always there.
            className="w-full pl-8 pr-9 [&::-webkit-search-cancel-button]:hidden"
            data-testid="drive-all-files-search"
          />
          {query ? (
            <button
              type="button"
              aria-label={t("searchClear")}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 focus-visible:outline-none focus-visible:ring-2"
              onClick={() => {
                debouncedSearch.cancel();
                setQuery("");
                setAppliedQuery("");
              }}
              data-testid="drive-all-files-search-clear"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" className="gap-2">
            <Search className="size-4" aria-hidden />
            {t("searchButton")}
          </Button>

          {isMobile ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => setFilterSheetOpen(true)}
            >
              <SlidersHorizontal className="size-4" />
              {activeFilterCount > 0
                ? t("filterButtonWithCount", { count: activeFilterCount })
                : t("filterButton")}
            </Button>
          ) : null}

          <DriveFileFilters
            filters={filters}
            labels={labels}
            onApply={applyFilters}
            onSaveCollection={(applied) => void saveCollection(applied)}
            hasQuery={appliedQuery.trim().length > 0}
            saveDisabled={collectionBusy}
            sheetOpen={filterSheetOpen}
            onSheetOpenChange={setFilterSheetOpen}
            hideDesktopTrigger={isMobile}
          />
        </div>

        {labelsState === "failed" ? (
          // Named for what actually failed, with a retry that retries it.
          <span className="text-muted-foreground flex items-center gap-2 text-xs">
            {t("labelsUnavailable")}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => void reloadLabels()}
            >
              {t("retry")}
            </button>
          </span>
        ) : null}
      </form>

      {/**
       * The types, one tap each.
       *
       * The same `typeFamilies` the filter popover sets, promoted because
       * "just the images" or "just the spreadsheets" is the commonest thing to
       * ask of a file list and it was three clicks deep.
       */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("filterType")}
        data-testid="drive-all-files-types"
      >
        <Button
          type="button"
          size="sm"
          variant={filters.typeFamilies.length === 0 ? "secondary" : "outline"}
          aria-pressed={filters.typeFamilies.length === 0}
          onClick={() => applyFilters({ ...filters, typeFamilies: [] })}
        >
          {t("typeAll")}
        </Button>
        {TYPE_CHIPS.map((family) => {
          const pressed = filters.typeFamilies.includes(family);
          return (
            <Button
              key={family}
              type="button"
              size="sm"
              variant={pressed ? "secondary" : "outline"}
              aria-pressed={pressed}
              onClick={() =>
                applyFilters({
                  ...filters,
                  typeFamilies: pressed
                    ? filters.typeFamilies.filter((entry) => entry !== family)
                    : [...filters.typeFamilies, family],
                })
              }
            >
              {t(`type.${family}`)}
            </Button>
          );
        })}
      </div>

      {browsing ? (
        <DriveFolderNav
          folders={folders}
          current={filters.folder}
          onSelect={(folder) => applyFilters({ ...filters, folder })}
          actions={filters.folder ? folderActions : null}
        />
      ) : null}

      {appliedFacets.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="drive-all-files-facets"
        >
          {appliedFacets.map((facet) => (
            <Badge key={facet.key} variant="secondary" className="gap-1 pr-1">
              <span className="truncate" title={facet.label}>
                {facet.label}
              </span>
              <button
                type="button"
                aria-label={t("removeTag", { name: facet.label })}
                className="hover:bg-card-background-hover focus-visible:ring-ring rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2"
                onClick={facet.remove}
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              applyFilters({ ...EMPTY_FILE_FILTERS, folder: filters.folder })
            }
          >
            {t("filterClear")}
          </Button>
        </div>
      ) : null}

      {/**
       * The saved-collections shelf, when there is a collection to show.
       *
       * It used to render unconditionally, so a reader who had never saved
       * anything — every reader, in a database with zero collections — got a
       * bookmark icon and "No saved collections yet" between the search box
       * and their files. An empty shelf is not a feature discovery surface, it
       * is a row of pixels in the way. Saving moved into the filter footer,
       * where the thing being saved is assembled.
       *
       * A failed load still says so: "you have none" and "we could not tell"
       * look identical otherwise, and only one of them is worth retrying.
       */}
      {collectionsState === "failed" || collections.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Bookmark className="text-muted-foreground size-4" aria-hidden />

          {collectionsState === "failed" ? (
            <span className="text-muted-foreground flex items-center gap-2 text-xs">
              {t("collectionsUnavailable")}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => void reloadCollections()}
              >
                {t("retry")}
              </button>
            </span>
          ) : (
            collections.map((collection) => (
              <span key={collection.id} className="flex items-center">
                <Button
                  size="sm"
                  variant={
                    activeCollectionId === collection.id
                      ? "secondary"
                      : "outline"
                  }
                  disabled={collectionBusy}
                  onClick={() => {
                    const definition = collection.definition as Partial<
                      FileSearchFilterState & { query?: string }
                    >;
                    applyFilters({ ...EMPTY_FILE_FILTERS, ...definition });
                    setQuery(definition.query ?? "");
                    setAppliedQuery(definition.query ?? "");
                    setActiveCollectionId(collection.id);
                  }}
                >
                  {collection.name}
                </Button>
                {collection.isOwner ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        // 44px on touch, which is the minimum this codebase
                        // uses elsewhere (`min-h-11`); a 32px target was
                        // comfortable with a mouse and a miss with a thumb.
                        className="size-11 @2xl:size-8"
                        disabled={collectionBusy}
                        aria-label={t("collectionActions", {
                          name: collection.name,
                        })}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() => void resaveCollection(collection)}
                      >
                        {t("collectionResave")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => void renameCollection(collection)}
                      >
                        {t("collectionRename")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void removeCollection(collection)}
                      >
                        {t("collectionDelete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </span>
            ))
          )}
        </div>
      ) : null}

      {/**
       * What the list is, in the reader's words, and only when there is
       * something to say.
       *
       * This said "Showing 10 of 10 in this result window" to a reader who had
       * not searched for anything. "Result window" is our word for our
       * pagination; a count of everything they own is not news. So: a count of
       * matches when they asked a question, the truncation warning only when
       * retrieval actually hit a budget, and silence otherwise. It stays an
       * `aria-live` region either way, because a screen reader has no other way
       * to learn that a list it is standing in just changed.
       */}
      <p
        className="text-muted-foreground text-xs empty:hidden"
        aria-live="polite"
        data-testid="drive-all-files-status"
      >
        {state.loading
          ? t("statusLoading")
          : state.meta
            ? [
                appliedQuery.trim().length > 0 || activeFilterCount > 0
                  ? t("statusMatches", { count: state.items.length })
                  : null,
                state.meta.truncated ? t("statusTruncated") : null,
                state.meta.indexCoverage.processing > 0
                  ? t("statusProcessing", {
                      count: state.meta.indexCoverage.processing,
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" \u00b7 ")
            : ""}
      </p>

      {selectionCount > 0 ? (
        <div className="bg-card-background flex flex-wrap items-center gap-2 rounded-lg border p-2">
          <span className="text-sm font-medium">
            {t("bulkSelected", { count: selectionCount })}
          </span>
          {state.meta?.nextCursor && !selectionToken ? (
            <Button size="sm" variant="ghost" onClick={selectWholeWindow}>
              {t("bulkSelectAllMatches", {
                count: state.meta.windowCount,
              })}
            </Button>
          ) : null}
          <DriveBulkCategoryPicker
            categories={categories}
            disabled={bulkBusy}
            onPick={(categoryLabelId) => void applyBulk({ categoryLabelId })}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedIds([]);
              setSelectionToken(null);
            }}
          >
            {t("bulkClear")}
          </Button>
        </div>
      ) : null}

      {state.loading ? (
        <DriveListSkeleton viewMode={viewMode} />
      ) : state.error ? (
        <div className="bg-card-background rounded-lg border p-6 text-center text-sm">
          <p>{state.error}</p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => void runSearch({ query: appliedQuery, filters })}
          >
            {t("retry")}
          </Button>
        </div>
      ) : state.items.length === 0 &&
        browsing &&
        childFolders(folders, filters.folder).length > 0 ? null : state.items
          .length === 0 ? (
        <div className="bg-card-background rounded-lg border p-10 text-center">
          <p className="text-sm font-medium">
            {appliedQuery || activeFilterCount > 0
              ? t("noMatchesTitle")
              : filters.folder
                ? t("folderEmptyTitle")
                : t("emptyTitle")}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {appliedQuery || activeFilterCount > 0
              ? t("noMatchesDescription")
              : t("emptyDescription")}
          </p>
          {activeFilterCount > 0 ? (
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => applyFilters({ ...EMPTY_FILE_FILTERS })}
            >
              {t("filterClear")}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {/**
           * No "Select this page" strip above the list.
           *
           * It was a bulk control offered before there was a selection to act
           * on, in the space between the search box and the first file. A
           * selection starts by ticking a row; the bulk bar then offers the
           * rest of the window, which is the only point at which "all of them"
           * means anything.
           */}
          <ul
            className={cn(
              viewMode === "grid"
                ? "grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3"
                : "divide-border bg-card-background divide-y rounded-lg border",
            )}
          >
            {state.items.map((item, index) => (
              <DriveFileRow
                key={item.id}
                item={item}
                viewMode={viewMode}
                selected={selectedIds.includes(item.id)}
                onToggle={(shiftKey) => toggleRow(index, item.id, shiftKey)}
                onOpen={() =>
                  setOpenFile({
                    id: item.id,
                    displayName: item.displayName,
                    mimeType: item.mimeType,
                  })
                }
                onDismissLabel={(label) => void dismissLabel(item, label.id)}
              />
            ))}
          </ul>

          {state.restarted ? (
            /**
             * Beside Load more, because that is where the surprise
             * happens. Deliberately plain: nothing about the reader's
             * files changed, only our bookmark into them, so this is not
             * an error and does not say so.
             */
            <p
              className="text-muted-foreground text-center text-xs"
              data-testid="drive-all-files-restarted"
            >
              {t("statusRestarted")}
            </p>
          ) : null}

          {state.meta?.hasMore ? (
            <Button
              variant="outline"
              className="self-center"
              disabled={state.loadingMore}
              onClick={() => void loadMore()}
            >
              {state.loadingMore ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("loadMore")}
            </Button>
          ) : state.meta?.truncated ? (
            <p className="text-muted-foreground text-center text-xs">
              {t("statusTruncated")}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
