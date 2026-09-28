"use client";

import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type {
  FileCollection,
  FileResource,
  FileSearchMeta,
  WorkspaceLabel,
} from "@/lib/clients/generated/core";
import {
  deleteDriveCollectionsById,
  getDriveCollections,
  getDriveFolders,
  getDriveLabels,
  getDriveResourcesById,
  getDriveResourcesByIdRelated,
  getDriveSearch,
  patchDriveCollectionsById,
  patchDriveResourcesByIdMetadata,
  postDriveCollections,
  postDriveResourcesByIdSuggestionsBySuggestionIdDecision,
  postDriveResourcesMetadataBatch,
  postDriveResourcesSelectionToken,
} from "@/lib/clients/generated/core";

/**
 * Browser calls for the Files surface.
 *
 * Every call carries the Drive store the page is in, because Core binds the
 * search to that store and to the active workspace. Nothing here caches
 * results across a scope change — a stale row from another workspace is the
 * one thing this list must never show.
 */

export type FileScope = "me" | "org";

export interface FileStore {
  scope: FileScope;
  organizationId?: string;
}

export interface FileSearchFilterState {
  categoryLabelIds: string[];
  tagLabelIds: string[];
  tagMatch: "any" | "all";
  projectIds: string[];
  sourceKinds: string[];
  typeFamilies: string[];
  extractionStates: string[];
  /**
   * One folder, and everything filed below it. Empty means the whole catalog.
   *
   * A facet rather than a place the reader navigates to: it narrows the same
   * list the search box searches, and composes with the query and with every
   * other filter here, which the folder browser it replaces could not.
   */
  folder: string;
}

export const EMPTY_FILE_FILTERS: FileSearchFilterState = {
  categoryLabelIds: [],
  tagLabelIds: [],
  tagMatch: "any",
  projectIds: [],
  sourceKinds: [],
  typeFamilies: [],
  extractionStates: [],
  folder: "",
};

export function countActiveFileFilters(filters: FileSearchFilterState): number {
  return (
    filters.categoryLabelIds.length +
    filters.tagLabelIds.length +
    filters.projectIds.length +
    filters.sourceKinds.length +
    filters.typeFamilies.length +
    filters.extractionStates.length +
    (filters.folder ? 1 : 0)
  );
}

function storeQuery(store: FileStore) {
  return store.scope === "org"
    ? { scope: "org" as const, organizationId: store.organizationId }
    : { scope: "me" as const };
}

function csv(values: string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}

export interface FileSearchPage {
  items: FileResource[];
  search: FileSearchMeta;
}

export async function fetchFileSearchPage(input: {
  store: FileStore;
  query: string;
  filters: FileSearchFilterState;
  sortBy: "relevance" | "modified" | "name";
  sortOrder: "asc" | "desc";
  cursor?: string | null;
  signal?: AbortSignal;
}): Promise<FileSearchPage> {
  const response = await getDriveSearch({
    client: getBrowserCoreClient(),
    query: {
      ...storeQuery(input.store),
      q: input.query.trim() || undefined,
      categoryLabelIds: csv(input.filters.categoryLabelIds),
      tagLabelIds: csv(input.filters.tagLabelIds),
      tagMatch: input.filters.tagMatch,
      projectIds: csv(input.filters.projectIds),
      sourceKinds: csv(input.filters.sourceKinds),
      typeFamilies: csv(input.filters.typeFamilies),
      extractionStates: csv(input.filters.extractionStates),
      folder: input.filters.folder || undefined,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      cursor: input.cursor ?? undefined,
    },
    signal: input.signal,
    throwOnError: true,
  });

  return response.data.data;
}

export async function fetchWorkspaceLabels(input: {
  store: FileStore;
  /**
   * One kind, when the caller only has a use for one. The tag picker on
   * the file detail page asks for TAG; leaving it off returns both, which
   * is what the filter panel and the bulk bar want.
   *
   * Archived entries are never returned — they keep historical
   * assignments readable but take no new ones — and a merged entry is
   * omitted in favour of the label it redirects to. Both are decided by
   * the endpoint, so a picker built on this cannot offer something the
   * edit would then refuse.
   */
  kind?: "TAG" | "CATEGORY";
  signal?: AbortSignal;
}): Promise<WorkspaceLabel[]> {
  const response = await getDriveLabels({
    client: getBrowserCoreClient(),
    query: { ...storeQuery(input.store), kind: input.kind },
    signal: input.signal,
    throwOnError: true,
  });
  return response.data.data;
}

/**
 * The folders the catalog can be narrowed to.
 *
 * Its own request, like the vocabulary above it, because the facet list is a
 * fact about the workspace rather than about one page of results — deriving it
 * from the loaded rows would have offered only the folders the reader could
 * already see, and would have changed every time they typed.
 */
export async function fetchWorkspaceFolders(input: {
  store: FileStore;
  signal?: AbortSignal;
}): Promise<string[]> {
  const response = await getDriveFolders({
    client: getBrowserCoreClient(),
    query: storeQuery(input.store),
    signal: input.signal,
    throwOnError: true,
  });
  return response.data.data;
}

export async function fetchFileCollections(input: {
  store: FileStore;
  signal?: AbortSignal;
}): Promise<FileCollection[]> {
  const response = await getDriveCollections({
    client: getBrowserCoreClient(),
    query: storeQuery(input.store),
    signal: input.signal,
    throwOnError: true,
  });
  return response.data.data;
}

/**
 * Save the current filters and sort as a collection.
 *
 * The store is the caller's own, deliberately: creating in one scope and
 * listing in another is how an author ends up unable to see what they just
 * saved. Both calls take the same `store`.
 */
export async function createFileCollection(input: {
  store: FileStore;
  name: string;
  definition: Record<string, unknown>;
  sortBy?: string | null;
  sortOrder?: "asc" | "desc" | null;
  signal?: AbortSignal;
}): Promise<FileCollection> {
  const response = await postDriveCollections({
    client: getBrowserCoreClient(),
    body: {
      ...storeQuery(input.store),
      name: input.name,
      definition: input.definition,
      sortBy: input.sortBy ?? null,
      sortOrder: input.sortOrder ?? null,
    },
    signal: input.signal,
    throwOnError: true,
  });
  return response.data.data;
}

/** Rename a collection, or re-save it over the current filters. */
export async function updateFileCollection(input: {
  store: FileStore;
  collectionId: string;
  name?: string;
  definition?: Record<string, unknown>;
  sortBy?: string | null;
  sortOrder?: "asc" | "desc" | null;
  signal?: AbortSignal;
}): Promise<FileCollection> {
  const response = await patchDriveCollectionsById({
    client: getBrowserCoreClient(),
    path: { id: input.collectionId },
    body: {
      ...storeQuery(input.store),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.definition === undefined
        ? {}
        : { definition: input.definition }),
      ...(input.sortBy === undefined ? {} : { sortBy: input.sortBy }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
    },
    signal: input.signal,
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteFileCollection(input: {
  store: FileStore;
  collectionId: string;
  signal?: AbortSignal;
}): Promise<void> {
  await deleteDriveCollectionsById({
    client: getBrowserCoreClient(),
    path: { id: input.collectionId },
    query: storeQuery(input.store),
    signal: input.signal,
    throwOnError: true,
  });
}

export async function fetchFileResource(input: {
  store: FileStore;
  resourceId: string;
  signal?: AbortSignal;
}): Promise<FileResource> {
  const response = await getDriveResourcesById({
    client: getBrowserCoreClient(),
    path: { id: input.resourceId },
    query: storeQuery(input.store),
    signal: input.signal,
    throwOnError: true,
  });
  return response.data.data;
}

export async function fetchRelatedFiles(input: {
  store: FileStore;
  resourceId: string;
  signal?: AbortSignal;
}): Promise<{ items: FileResource[]; state: string }> {
  const response = await getDriveResourcesByIdRelated({
    client: getBrowserCoreClient(),
    path: { id: input.resourceId },
    query: storeQuery(input.store),
    signal: input.signal,
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateFileMetadata(input: {
  store: FileStore;
  resourceId: string;
  expectedMetadataRevision: number;
  addTagLabelIds?: string[];
  removeTagLabelIds?: string[];
  categoryLabelId?: string | null;
  confirmProjectIds?: string[];
  removeProjectIds?: string[];
  allowSuggestionsFor?: ("category" | "tags")[];
  /**
   * Withdraw the veto on these labels: delete each one's rejection so the model
   * may propose it again.
   *
   * It does not re-apply the label, and that is the point — a person vetoes a
   * label or withdraws a veto, and the model still decides. Distinct from
   * `allowSuggestionsFor`, which is field-scoped and clears a manual pin.
   */
  allowSuggestionsForLabelIds?: string[];
}): Promise<FileResource> {
  const response = await patchDriveResourcesByIdMetadata({
    client: getBrowserCoreClient(),
    path: { id: input.resourceId },
    query: storeQuery(input.store),
    body: {
      expectedMetadataRevision: input.expectedMetadataRevision,
      addTagLabelIds: input.addTagLabelIds,
      removeTagLabelIds: input.removeTagLabelIds,
      categoryLabelId: input.categoryLabelId,
      confirmProjectIds: input.confirmProjectIds,
      removeProjectIds: input.removeProjectIds,
      allowSuggestionsFor: input.allowSuggestionsFor,
      allowSuggestionsForLabelIds: input.allowSuggestionsForLabelIds,
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function decideSuggestion(input: {
  store: FileStore;
  resourceId: string;
  suggestionId: string;
  decision: "accept" | "reject" | "restore";
  expectedMetadataRevision: number;
}): Promise<FileResource> {
  const response =
    await postDriveResourcesByIdSuggestionsBySuggestionIdDecision({
      client: getBrowserCoreClient(),
      path: { id: input.resourceId, suggestionId: input.suggestionId },
      query: storeQuery(input.store),
      body: {
        decision: input.decision,
        expectedMetadataRevision: input.expectedMetadataRevision,
      },
      throwOnError: true,
    });
  return response.data.data;
}

export async function createSelectionToken(input: {
  store: FileStore;
  windowCursor: string;
}): Promise<{ token: string; count: number }> {
  const response = await postDriveResourcesSelectionToken({
    client: getBrowserCoreClient(),
    body: { ...storeQuery(input.store), windowCursor: input.windowCursor },
    throwOnError: true,
  });
  return response.data.data;
}

export interface BatchOutcome {
  resourceId: string;
  status: "applied" | "conflict" | "forbidden" | "not-found";
  metadataRevision: number | null;
}

export async function applyMetadataBatch(input: {
  store: FileStore;
  resourceIds?: string[];
  selectionToken?: string;
  expectedRevisions?: { resourceId: string; metadataRevision: number }[];
  addTagLabelIds?: string[];
  removeTagLabelIds?: string[];
  categoryLabelId?: string | null;
}): Promise<{ outcomes: BatchOutcome[]; revisedCount: number | null }> {
  const response = await postDriveResourcesMetadataBatch({
    client: getBrowserCoreClient(),
    body: {
      ...storeQuery(input.store),
      resourceIds: input.resourceIds,
      selectionToken: input.selectionToken,
      expectedRevisions: input.expectedRevisions,
      addTagLabelIds: input.addTagLabelIds,
      removeTagLabelIds: input.removeTagLabelIds,
      categoryLabelId: input.categoryLabelId,
      idempotencyKey: crypto.randomUUID(),
    },
    throwOnError: true,
  });
  return response.data.data;
}
