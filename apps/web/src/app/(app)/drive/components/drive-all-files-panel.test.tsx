import type {
  FileCollection,
  FileResource,
  FileSearchMeta,
  WorkspaceLabel,
} from "@sokosumi/core-client";
import {
  type InfiniteData,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSearchPage, FileStore } from "@/lib/utils/file-search.client";

const api = vi.hoisted(() => ({
  fetchFileSearchPage: vi.fn(),
  fetchWorkspaceFolders: vi.fn(),
  fetchWorkspaceLabels: vi.fn(),
  fetchFileCollections: vi.fn(),
  createFileCollection: vi.fn(),
  updateFileCollection: vi.fn(),
  deleteFileCollection: vi.fn(),
  deleteDriveUploads: vi.fn(),
  decideSuggestion: vi.fn(),
}));

vi.mock("@/lib/utils/file-search.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/file-search.client")>()),
  ...api,
}));

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

function translate(key: string, values?: Record<string, unknown>) {
  return values ? `${key}:${JSON.stringify(values)}` : key;
}

vi.mock("next-intl", () => ({
  useTranslations: () => translate,
}));

vi.mock("@/app/drive/components/drive-file-viewer", () => ({
  DriveFileViewer: () => null,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    onSelect,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    onSelect?: (event: { preventDefault: () => void }) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onClick?.();
        onSelect?.({ preventDefault: () => undefined });
      }}
    >
      {children}
    </button>
  ),
}));

import { driveQueryKeys, invalidateDrive } from "@/queries/drive";
import { buildScopedQueryKey } from "@/queries/scoped-queries";
import { DriveAllFilesPanel } from "./drive-all-files-panel";

const orgA: FileStore = { scope: "org", organizationId: "org_a" };
const orgB: FileStore = { scope: "org", organizationId: "org_b" };

function makeMeta(overrides: Partial<FileSearchMeta> = {}): FileSearchMeta {
  return {
    rankingMode: "deterministic",
    rankingFallback: null,
    resultWindowLimit: 120,
    windowCount: 2,
    remainingWindowCount: 0,
    truncated: false,
    hasMore: false,
    nextCursor: null,
    restarted: false,
    indexCoverage: { indexed: 2, processing: 0, unsupported: 0 },
    ...overrides,
  } as FileSearchMeta;
}

function makeFile(
  id: string,
  displayName: string,
  overrides: Partial<FileResource> = {},
): FileResource {
  return {
    id,
    displayName,
    pathname: `drive/orgs/org_a/${displayName}`,
    sourceKind: "DRIVE_UPLOAD",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    metadataRevision: 1,
    category: null,
    tags: [],
    projects: [],
    snippet: null,
    filenameMatch: false,
    ...overrides,
  } as unknown as FileResource;
}

function makeCollection(
  id: string,
  name: string,
  overrides: Partial<FileCollection> = {},
): FileCollection {
  return {
    id,
    name,
    isOwner: true,
    definition: { query: "", typeFamilies: ["document"] },
    ...overrides,
  } as unknown as FileCollection;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof DriveAllFilesPanel>> = {},
  client = makeQueryClient(),
) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <DriveAllFilesPanel
          store={orgA}
          viewMode="list"
          isMobile={false}
          {...props}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("DriveAllFilesPanel on the Drive cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchWorkspaceFolders.mockResolvedValue([]);
    api.fetchWorkspaceLabels.mockResolvedValue([] as WorkspaceLabel[]);
    api.fetchFileCollections.mockResolvedValue([] as FileCollection[]);
    api.fetchFileSearchPage.mockResolvedValue({
      items: [],
      search: makeMeta(),
    } satisfies FileSearchPage);
  });

  it("removes bulk-deleted files from catalog, recents, and picker caches before refetch returns", async () => {
    const user = userEvent.setup();
    const fileKeep = makeFile("res_keep", "keep.pdf");
    const fileDrop = makeFile("res_drop", "drop.pdf");
    const refetchDeferred = Promise.withResolvers<FileSearchPage>();

    api.fetchFileSearchPage
      .mockResolvedValueOnce({
        items: [fileKeep, fileDrop],
        search: makeMeta({ windowCount: 2 }),
      })
      .mockImplementationOnce(() => refetchDeferred.promise);
    api.deleteDriveUploads.mockResolvedValueOnce([]);

    const client = makeQueryClient();
    const recentsKey = buildScopedQueryKey(orgA, ["drive", "recents", "all"]);
    const pickerKey = buildScopedQueryKey(orgA, ["drive", "picker", "root"]);
    const orgBPickerKey = buildScopedQueryKey(orgB, [
      "drive",
      "picker",
      "root",
    ]);

    client.setQueryData<
      InfiniteData<{
        items: Array<{
          kind: "drive-file";
          resourceId: string;
          pathname: string;
        }>;
      }>
    >(recentsKey, {
      pages: [
        {
          items: [
            {
              kind: "drive-file",
              resourceId: "res_keep",
              pathname: "drive/orgs/org_a/keep.pdf",
            },
            {
              kind: "drive-file",
              resourceId: "res_drop",
              pathname: "drive/orgs/org_a/drop.pdf",
            },
          ],
        },
      ],
      pageParams: [null],
    });
    client.setQueryData(pickerKey, [
      { type: "file", name: "keep.pdf", pathname: "drive/orgs/org_a/keep.pdf" },
      { type: "file", name: "drop.pdf", pathname: "drive/orgs/org_a/drop.pdf" },
    ]);
    client.setQueryData(orgBPickerKey, [
      { type: "file", name: "drop.pdf", pathname: "drive/orgs/org_a/drop.pdf" },
    ]);

    renderPanel({}, client);

    expect(await screen.findByText("drop.pdf")).toBeVisible();
    expect(screen.getByText("keep.pdf")).toBeVisible();

    await user.click(
      screen.getByRole("checkbox", {
        name: 'selectFile:{"name":"drop.pdf"}',
      }),
    );
    await user.click(screen.getByRole("button", { name: "bulkDelete" }));
    const deleteButtons = screen.getAllByRole("button", { name: "bulkDelete" });
    await user.click(deleteButtons[deleteButtons.length - 1]);

    // Before the catalog refetch returns, drop.pdf is already gone everywhere in orgA.
    await waitFor(() => {
      expect(screen.queryByText("drop.pdf")).toBeNull();
    });
    expect(screen.getByText("keep.pdf")).toBeVisible();
    expect(
      client.getQueryData<
        InfiniteData<{ items: Array<{ resourceId: string; pathname: string }> }>
      >(recentsKey)?.pages[0]?.items,
    ).toEqual([
      {
        kind: "drive-file",
        resourceId: "res_keep",
        pathname: "drive/orgs/org_a/keep.pdf",
      },
    ]);
    expect(client.getQueryData(pickerKey)).toEqual([
      { type: "file", name: "keep.pdf", pathname: "drive/orgs/org_a/keep.pdf" },
    ]);
    // Other workspace cache stays untouched.
    expect(client.getQueryData(orgBPickerKey)).toHaveLength(1);
    expect(client.getQueryState(recentsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(pickerKey)?.isInvalidated).toBe(true);

    await act(async () => {
      refetchDeferred.resolve({
        items: [fileKeep],
        search: makeMeta({ windowCount: 1 }),
      });
      await refetchDeferred.promise;
    });
  });

  it("does not invalidate Drive when every item in a bulk delete fails", async () => {
    const user = userEvent.setup();
    const fileA = makeFile("res_a", "a.pdf");

    api.fetchFileSearchPage.mockResolvedValue({
      items: [fileA],
      search: makeMeta({ windowCount: 1 }),
    });
    api.deleteDriveUploads.mockResolvedValueOnce([fileA.pathname!]);

    const client = makeQueryClient();
    const pickerKey = buildScopedQueryKey(orgA, ["drive", "picker", "root"]);
    client.setQueryData(pickerKey, [
      { type: "file", name: "a.pdf", pathname: fileA.pathname },
    ]);

    renderPanel({}, client);

    expect(await screen.findByText("a.pdf")).toBeVisible();
    await user.click(
      screen.getByRole("checkbox", { name: 'selectFile:{"name":"a.pdf"}' }),
    );
    await user.click(screen.getByRole("button", { name: "bulkDelete" }));
    const deleteButtons = screen.getAllByRole("button", { name: "bulkDelete" });
    await user.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalled();
    });
    expect(api.fetchFileSearchPage).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(pickerKey)?.isInvalidated).toBe(false);
    expect(screen.getByText("a.pdf")).toBeVisible();
  });

  it("disables Load more while page one refreshes and does not cancel an in-flight refresh on an interleaved click", async () => {
    const file1 = makeFile("res_1", "page1.pdf");
    const refreshedFile = makeFile("res_2", "refreshed.pdf");
    const refreshDeferred = Promise.withResolvers<FileSearchPage>();
    let refreshSignal: AbortSignal | undefined;

    api.fetchFileSearchPage
      .mockResolvedValueOnce({
        items: [file1],
        search: makeMeta({ hasMore: true, nextCursor: "cursor_2" }),
      })
      .mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
        refreshSignal = signal;
        return refreshDeferred.promise;
      });

    const { client } = renderPanel();

    const loadMore = await screen.findByRole("button", { name: "loadMore" });
    expect(loadMore).toBeEnabled();

    // Start a page-one refresh and fire a click on Load more before React
    // commits `disabled`, matching a fast click racing invalidation.
    const invalidation = client.invalidateQueries({
      queryKey: driveQueryKeys.prefix(orgA),
    });
    fireEvent.click(loadMore);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "loadMore" })).toBeDisabled();
    });
    // `{ cancelRefetch: false }` leaves the page-one refresh intact with no stale cursor fetch.
    expect(refreshSignal?.aborted).toBe(false);
    expect(api.fetchFileSearchPage).toHaveBeenCalledTimes(2);

    await act(async () => {
      refreshDeferred.resolve({
        items: [refreshedFile],
        search: makeMeta({ hasMore: true, nextCursor: "cursor_fresh" }),
      });
      await invalidation;
    });

    expect(await screen.findByText("refreshed.pdf")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "loadMore" })).toBeEnabled();
    });
  });

  it("keeps loaded rows visible when a page-one refresh fails without showing the later-page Retry row", async () => {
    const file1 = makeFile("res_1", "kept.pdf");

    api.fetchFileSearchPage
      .mockResolvedValueOnce({
        items: [file1],
        search: makeMeta({ hasMore: true, nextCursor: "cursor_2" }),
      })
      .mockRejectedValueOnce(new Error("refresh failed"));

    const { client } = renderPanel();

    expect(await screen.findByText("kept.pdf")).toBeVisible();

    await act(async () => {
      await invalidateDrive(client, orgA);
    });

    expect(screen.getByText("kept.pdf")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "loadMore" })).toBeEnabled();
  });

  it("keeps loaded pages and shows Retry when loading a later page fails", async () => {
    const user = userEvent.setup();
    const file1 = makeFile("res_1", "first.pdf");
    const file2 = makeFile("res_2", "second.pdf");

    api.fetchFileSearchPage
      .mockResolvedValueOnce({
        items: [file1],
        search: makeMeta({ hasMore: true, nextCursor: "cursor_2" }),
      })
      .mockRejectedValueOnce(new Error("page two down"))
      .mockResolvedValueOnce({
        items: [file2],
        search: makeMeta({ hasMore: false, nextCursor: null }),
      });

    renderPanel();

    expect(await screen.findByText("first.pdf")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "loadMore" }));

    const retry = await screen.findByRole("button", { name: "retry" });
    expect(screen.getByText("first.pdf")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("searchError");

    await user.click(retry);

    expect(await screen.findByText("second.pdf")).toBeVisible();
    expect(screen.getByText("first.pdf")).toBeVisible();
    expect(screen.queryByRole("button", { name: "retry" })).toBeNull();
  });

  it("replaces rows and shows the restarted notice when Load more hits an expired search window", async () => {
    const user = userEvent.setup();
    const oldFile = makeFile("res_old", "old.pdf");
    const freshFile = makeFile("res_fresh", "fresh.pdf");

    api.fetchFileSearchPage
      .mockResolvedValueOnce({
        items: [oldFile],
        search: makeMeta({
          hasMore: true,
          nextCursor: "cursor_2",
          restarted: false,
        }),
      })
      .mockResolvedValueOnce({
        items: [freshFile],
        search: makeMeta({
          hasMore: false,
          nextCursor: null,
          restarted: true,
        }),
      });

    renderPanel();

    expect(await screen.findByText("old.pdf")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "loadMore" }));

    expect(await screen.findByText("fresh.pdf")).toBeVisible();
    expect(screen.queryByText("old.pdf")).toBeNull();
    expect(screen.getByTestId("drive-all-files-restarted")).toHaveTextContent(
      "statusRestarted",
    );
  });

  it("waits for server result on collection rename and delete without optimistic mutations", async () => {
    const user = userEvent.setup();
    const renameDeferred = Promise.withResolvers<FileCollection>();
    const deleteDeferred = Promise.withResolvers<void>();
    const deleteRefetchDeferred = Promise.withResolvers<FileCollection[]>();
    const initial = makeCollection("col_1", "Invoices");
    const renamed = makeCollection("col_1", "Receipts (server)");

    api.fetchFileCollections
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([renamed])
      .mockImplementationOnce(() => deleteRefetchDeferred.promise);
    api.updateFileCollection.mockImplementationOnce(
      () => renameDeferred.promise,
    );
    api.deleteFileCollection.mockImplementationOnce(
      () => deleteDeferred.promise,
    );
    vi.stubGlobal("prompt", () => "Receipts");

    renderPanel();

    expect(
      await screen.findByRole("button", { name: "Invoices" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "collectionRename" }));

    // No optimistic rename: the old name stays until the server responds and refetches.
    expect(screen.getByRole("button", { name: "Invoices" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Receipts" })).toBeNull();

    await act(async () => {
      renameDeferred.resolve(renamed);
      await renameDeferred.promise;
    });

    expect(
      await screen.findByRole("button", { name: "Receipts (server)" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "collectionDelete" }));

    // No optimistic delete: chip stays while delete is in flight.
    expect(
      screen.getByRole("button", { name: "Receipts (server)" }),
    ).toBeVisible();

    await act(async () => {
      deleteDeferred.resolve();
      await deleteDeferred.promise;
    });

    await waitFor(() => {
      expect(api.fetchFileCollections).toHaveBeenCalledTimes(3);
    });
    // Shelf waits for the collections GET refetch rather than patching deletedIds.
    expect(
      screen.getByRole("button", { name: "Receipts (server)" }),
    ).toBeVisible();

    await act(async () => {
      deleteRefetchDeferred.resolve([]);
      await deleteRefetchDeferred.promise;
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Receipts (server)" }),
      ).toBeNull();
    });
  });

  it("invalidates Drive after dismissing and undoing a suggested label", async () => {
    const user = userEvent.setup();
    const suggestedTag = {
      id: "sug_1",
      labelId: "lbl_1",
      displayName: "Finance",
      state: "SUGGESTED",
      evidenceSnippet: null,
    };
    const fileWithTag = makeFile("res_1", "report.pdf", {
      tags: [suggestedTag] as unknown as FileResource["tags"],
      metadataRevision: 2,
    });
    const fileWithoutTag = makeFile("res_1", "report.pdf", {
      tags: [],
      metadataRevision: 3,
    });

    api.fetchFileSearchPage
      .mockResolvedValueOnce({
        items: [fileWithTag],
        search: makeMeta({ windowCount: 1 }),
      })
      .mockResolvedValueOnce({
        items: [fileWithoutTag],
        search: makeMeta({ windowCount: 1 }),
      })
      .mockResolvedValueOnce({
        items: [fileWithTag],
        search: makeMeta({ windowCount: 1 }),
      });
    api.decideSuggestion
      .mockResolvedValueOnce(fileWithoutTag)
      .mockResolvedValueOnce(fileWithTag);

    renderPanel();

    const removeBtn = await screen.findByRole("button", {
      name: 'removeTag:{"name":"Finance"}',
    });
    await user.click(removeBtn);

    await waitFor(() => {
      expect(screen.queryByText("Finance")).toBeNull();
    });
    expect(api.decideSuggestion).toHaveBeenCalledWith({
      store: orgA,
      resourceId: "res_1",
      suggestionId: "sug_1",
      decision: "reject",
      expectedMetadataRevision: 2,
    });

    const toastOptions = toast.success.mock.calls.at(-1)?.[1] as {
      action: { onClick: () => void };
    };
    await act(async () => {
      toastOptions.action.onClick();
    });

    expect(await screen.findByText("Finance")).toBeVisible();
    expect(api.decideSuggestion).toHaveBeenLastCalledWith({
      store: orgA,
      resourceId: "res_1",
      suggestionId: "sug_1",
      decision: "restore",
      expectedMetadataRevision: 3,
    });
  });

  it("never renders a late workspace A response under workspace B", async () => {
    const orgADeferred = Promise.withResolvers<FileSearchPage>();
    const orgAFoldersDeferred = Promise.withResolvers<string[]>();
    const orgBFile = makeFile("res_b", "org-b.pdf", {
      pathname: "drive/orgs/org_b/org-b.pdf",
    });

    api.fetchFileSearchPage
      .mockImplementationOnce(() => orgADeferred.promise)
      .mockResolvedValueOnce({
        items: [orgBFile],
        search: makeMeta({ windowCount: 1 }),
      });
    api.fetchWorkspaceFolders
      .mockImplementationOnce(() => orgAFoldersDeferred.promise)
      .mockResolvedValueOnce(["OrgBFolder"]);

    const client = makeQueryClient();
    const { rerender } = renderPanel({ store: orgA }, client);

    await waitFor(() => {
      expect(api.fetchFileSearchPage).toHaveBeenCalledTimes(1);
    });

    rerender(
      <QueryClientProvider client={client}>
        <DriveAllFilesPanel store={orgB} viewMode="list" isMobile={false} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("org-b.pdf")).toBeVisible();
    expect(screen.getByRole("button", { name: "OrgBFolder" })).toBeVisible();

    await act(async () => {
      orgADeferred.resolve({
        items: [makeFile("res_a", "org-a.pdf")],
        search: makeMeta({ windowCount: 1 }),
      });
      orgAFoldersDeferred.resolve(["OrgAFolder"]);
      await Promise.all([orgADeferred.promise, orgAFoldersDeferred.promise]);
    });

    expect(screen.queryByText("org-a.pdf")).toBeNull();
    expect(screen.queryByRole("button", { name: "OrgAFolder" })).toBeNull();
    expect(screen.getByText("org-b.pdf")).toBeVisible();
    expect(client.getQueryData(driveQueryKeys.folders(orgB))).toEqual([
      "OrgBFolder",
    ]);
  });
});
