"use client";

import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type {
  FileCollection,
  FileResource,
  FileSearchMeta,
  WorkspaceLabel,
} from "@/lib/clients/generated/core";
import {
  getDriveCollections,
  getDriveLabels,
  getDriveResourcesById,
  getDriveResourcesByIdRelated,
  getDriveSearch,
  patchDriveResourcesByIdMetadata,
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
}

export const EMPTY_FILE_FILTERS: FileSearchFilterState = {
  categoryLabelIds: [],
  tagLabelIds: [],
  tagMatch: "any",
  projectIds: [],
  sourceKinds: [],
  typeFamilies: [],
  extractionStates: [],
};

export function countActiveFileFilters(filters: FileSearchFilterState): number {
  return (
    filters.categoryLabelIds.length +
    filters.tagLabelIds.length +
    filters.projectIds.length +
    filters.sourceKinds.length +
    filters.typeFamilies.length +
    filters.extractionStates.length
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
  signal?: AbortSignal;
}): Promise<WorkspaceLabel[]> {
  const response = await getDriveLabels({
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
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function decideSuggestion(input: {
  store: FileStore;
  resourceId: string;
  suggestionId: string;
  decision: "accept" | "reject";
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
