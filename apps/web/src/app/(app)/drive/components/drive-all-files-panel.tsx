"use client";

import { Bookmark, Loader2, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

import { DriveFileFilters } from "@/app/drive/components/drive-file-filters";
import { DriveFileSnippet } from "@/app/drive/components/drive-file-snippet";
import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileTypeIcon } from "@/components/ui/file-icon";
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
  createSelectionToken,
  EMPTY_FILE_FILTERS,
  type FileSearchFilterState,
  type FileStore,
  fetchFileCollections,
  fetchFileSearchPage,
  fetchWorkspaceLabels,
} from "@/lib/utils/file-search.client";

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

/** Last dotted segment, lowercased. Empty for a name with no extension. */
function fileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop() ?? "").toLowerCase() : "";
}

export interface DriveAllFilesPanelProps {
  store: FileStore;
  viewMode: FilesViewMode;
  isMobile: boolean;
}

interface SearchState {
  items: FileResource[];
  meta: FileSearchMeta | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

export function DriveAllFilesPanel({
  store,
  viewMode,
  isMobile,
}: DriveAllFilesPanelProps) {
  const t = useTranslations("App.Drive.Files");

  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [filters, setFilters] = useState<FileSearchFilterState>({
    ...EMPTY_FILE_FILTERS,
  });
  const [labels, setLabels] = useState<WorkspaceLabel[]>([]);
  const [collections, setCollections] = useState<FileCollection[]>([]);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionToken, setSelectionToken] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [state, setState] = useState<SearchState>({
    items: [],
    meta: null,
    loading: true,
    loadingMore: false,
    error: null,
  });

  const sequenceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);

  const storeKey = `${store.scope}:${store.organizationId ?? ""}`;

  const runSearch = useCallback(
    async (input: { query: string; filters: FileSearchFilterState }) => {
      const sequence = sequenceRef.current + 1;
      sequenceRef.current = sequence;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((current) => ({ ...current, loading: true, error: null }));

      try {
        const page = await fetchFileSearchPage({
          store,
          query: input.query,
          filters: input.filters,
          sortBy: input.query.trim().length > 0 ? "relevance" : "modified",
          sortOrder: "desc",
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
        });
        setSelectedIds([]);
        setSelectionToken(null);
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

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setAppliedQuery(value);
  }, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    void runSearch({ query: appliedQuery, filters });
  }, [appliedQuery, filters, runSearch]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [nextLabels, nextCollections] = await Promise.all([
          fetchWorkspaceLabels({ store, signal: controller.signal }),
          fetchFileCollections({ store, signal: controller.signal }),
        ]);
        setLabels(nextLabels);
        setCollections(nextCollections);
      } catch {
        // Vocabulary is an aid, not the list. A failure here must not empty
        // the results the reader came for.
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
    });
  }, [storeKey]);

  async function loadMore() {
    const cursor = state.meta?.nextCursor;
    if (!cursor || state.loadingMore) return;

    setState((current) => ({ ...current, loadingMore: true }));
    try {
      const page = await fetchFileSearchPage({
        store,
        query: appliedQuery,
        filters,
        sortBy: appliedQuery.trim().length > 0 ? "relevance" : "modified",
        sortOrder: "desc",
        cursor,
      });
      setState((current) => ({
        // A later page can be short or empty when entries changed. That is
        // the snapshot working, not an error.
        items: [...current.items, ...page.items],
        meta: page.search,
        loading: false,
        loadingMore: false,
        error: null,
      }));
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
      await runSearch({ query: appliedQuery, filters });
    } catch {
      toast.error(t("bulkError"));
    } finally {
      setBulkBusy(false);
    }
  }

  const activeFilterCount = countActiveFileFilters(filters);
  const selectionCount = selectionToken
    ? (state.meta?.windowCount ?? selectedIds.length)
    : selectedIds.length;

  return (
    <div className="flex flex-col gap-4" data-testid="drive-all-files">
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center">
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
            className="w-full pl-8"
            data-testid="drive-all-files-search"
          />
        </div>

        {isMobile ? (
          <Button
            variant="outline"
            className="gap-2 self-start"
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
          onApply={setFilters}
          sheetOpen={filterSheetOpen}
          onSheetOpenChange={setFilterSheetOpen}
          hideDesktopTrigger={isMobile}
        />
      </div>

      {collections.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Bookmark className="text-muted-foreground size-4" />
          {collections.map((collection) => (
            <Button
              key={collection.id}
              size="sm"
              variant="outline"
              onClick={() => {
                const definition = collection.definition as Partial<
                  FileSearchFilterState & { query?: string }
                >;
                setFilters({ ...EMPTY_FILE_FILTERS, ...definition });
                setQuery(definition.query ?? "");
                setAppliedQuery(definition.query ?? "");
              }}
            >
              {collection.name}
            </Button>
          ))}
        </div>
      ) : null}

      <p
        className="text-muted-foreground text-xs"
        aria-live="polite"
        data-testid="drive-all-files-status"
      >
        {state.loading
          ? t("statusLoading")
          : state.meta
            ? t("statusShown", {
                shown: state.items.length,
                window: state.meta.windowCount,
              }) +
              (state.meta.truncated ? ` · ${t("statusTruncated")}` : "") +
              (state.meta.indexCoverage.processing > 0
                ? ` · ${t("statusProcessing", {
                    count: state.meta.indexCoverage.processing,
                  })}`
                : "")
            : ""}
      </p>

      {selectionCount > 0 ? (
        <div className="bg-card-background flex flex-wrap items-center gap-2 rounded-lg border p-2">
          <span className="text-sm font-medium">
            {t("bulkSelected", { count: selectionCount })}
          </span>
          {state.meta?.nextCursor && !selectionToken ? (
            <Button size="sm" variant="ghost" onClick={selectWholeWindow}>
              {t("bulkSelectWindow", {
                count: state.meta.windowCount,
              })}
            </Button>
          ) : null}
          {labels
            .filter((label) => label.kind === "CATEGORY")
            .slice(0, 4)
            .map((label) => (
              <Button
                key={label.id}
                size="sm"
                variant="outline"
                disabled={bulkBusy}
                onClick={() => void applyBulk({ categoryLabelId: label.id })}
              >
                {t("bulkSetCategory", { name: label.displayName })}
              </Button>
            ))}
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
      ) : state.items.length === 0 ? (
        <div className="bg-card-background rounded-lg border p-10 text-center">
          <p className="text-sm font-medium">
            {appliedQuery || activeFilterCount > 0
              ? t("noMatchesTitle")
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
              onClick={() => setFilters({ ...EMPTY_FILE_FILTERS })}
            >
              {t("filterClear")}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              checked={
                state.items.length > 0 &&
                state.items.every((item) => selectedIds.includes(item.id))
              }
              onCheckedChange={(checked) =>
                checked ? selectThisPage() : setSelectedIds([])
              }
              aria-label={t("bulkSelectPage")}
            />
            <span className="text-muted-foreground text-xs">
              {t("bulkSelectPage")}
            </span>
          </div>

          <ul
            className={cn(
              viewMode === "grid"
                ? "grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3"
                : "divide-border bg-card-background divide-y rounded-lg border",
            )}
          >
            {state.items.map((item, index) => (
              <li
                key={item.id}
                className={cn(
                  "flex items-start gap-3 p-3",
                  viewMode === "grid" && "bg-card-background rounded-lg border",
                )}
              >
                <Checkbox
                  checked={selectedIds.includes(item.id)}
                  aria-label={t("selectFile", { name: item.displayName })}
                  onClick={(event) => toggleRow(index, item.id, event.shiftKey)}
                  onCheckedChange={() => undefined}
                  className="mt-1"
                />
                <span className="mt-0.5 size-5 shrink-0">
                  <FileTypeIcon extension={fileExtension(item.displayName)} />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/drive/files/${item.id}`}
                    className="focus-visible:ring-ring block truncate text-sm font-medium focus-visible:outline-none focus-visible:ring-2"
                  >
                    {item.displayName}
                  </Link>
                  {item.filenameMatch ? (
                    <span className="text-muted-foreground text-xs">
                      {t("filenameMatch")}
                    </span>
                  ) : item.snippet ? (
                    <DriveFileSnippet snippet={item.snippet} />
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {item.category ? (
                      <Badge variant="secondary">
                        {item.category.displayName}
                      </Badge>
                    ) : null}
                    {item.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag.id} variant="outline">
                        {tag.displayName}
                      </Badge>
                    ))}
                    {item.tags.length > 2 ? (
                      <span className="text-muted-foreground text-xs">
                        +{item.tags.length - 2}
                      </span>
                    ) : null}
                    {item.suggestions.length > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-dashed"
                        title={item.suggestions[0].evidenceSnippet ?? undefined}
                      >
                        {t("suggestedChip", {
                          name: item.suggestions[0].displayName,
                        })}
                      </Badge>
                    ) : null}
                    {item.extractionState === "PENDING" ||
                    item.extractionState === "RUNNING" ? (
                      <Badge variant="outline">{t("badgeProcessing")}</Badge>
                    ) : item.extractionState === "UNSUPPORTED" ? (
                      <Badge variant="outline">{t("badgeFilenameOnly")}</Badge>
                    ) : item.extractionState === "PARTIAL" ? (
                      <Badge variant="outline">{t("badgePartial")}</Badge>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>

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

      <span className="sr-only" data-testid="drive-all-files-store">
        {storeKey}
      </span>
    </div>
  );
}
