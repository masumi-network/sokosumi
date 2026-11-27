import type {
  DriveFile,
  DriveFileItem,
  DriveItem,
  FileCollection,
  FileResource,
  FileSearchMeta,
  WorkspaceLabel,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  fetchFolderReadme: vi.fn(),
}));

const listDriveItemsMock = vi.hoisted(() => vi.fn());
const useSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/utils/file-search.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/file-search.client")>()),
  ...api,
}));

vi.mock("@/lib/utils/drive-file-list.client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/utils/drive-file-list.client")
  >()),
  listDriveItems: (...args: unknown[]) => listDriveItemsMock(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("@/hooks/effects/use-drive-organization-name", () => ({
  useDriveOrganizationName: () => "Org A",
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 0,
  }),
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

const formatter = {
  dateTime: () => "Jan 1",
  number: (value: number) => String(value),
};

vi.mock("next-intl", () => ({
  useTranslations: () => translate,
  useFormatter: () => formatter,
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

import { DriveFilePicker } from "@/components/drive/drive-file-picker";
import { driveQueryKeys, invalidateDrive } from "@/queries/drive";
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

function makePickerFile(
  name: string,
  overrides: Partial<DriveFile> = {},
): DriveFileItem {
  return {
    type: "file",
    name,
    fileUrl: `https://blob.example/${name}`,
    pathname: `drive/orgs/org_a/${name}`,
    size: 1024,
    uploadedAt: new Date("2026-08-18T10:00:00.000Z"),
    dataRoom: false,
    ...overrides,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
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
    for (const fn of Object.values(api)) {
      fn.mockReset();
    }
    listDriveItemsMock.mockReset();
    listDriveItemsMock.mockResolvedValue([]);
    useSessionMock.mockReturnValue({
      data: {
        user: { id: "user_1" },
        session: { activeOrganizationId: "org_a" },
      },
    });
    api.fetchWorkspaceFolders.mockResolvedValue([]);
    api.fetchWorkspaceLabels.mockResolvedValue([] as WorkspaceLabel[]);
    api.fetchFileCollections.mockResolvedValue([] as FileCollection[]);
    api.fetchFileSearchPage.mockResolvedValue({
      items: [],
      search: makeMeta(),
    } satisfies FileSearchPage);
    api.fetchFolderReadme.mockResolvedValue(null);
  });

  it("offers the page's create actions in an empty catalog, not in an empty search", async () => {
    const user = userEvent.setup();
    renderPanel({ emptyActions: <button type="button">emptyUpload</button> });

    expect(await screen.findByText("emptyTitle")).toBeVisible();
    expect(screen.getByRole("button", { name: "emptyUpload" })).toBeVisible();

    await user.type(screen.getByLabelText("searchLabel"), "nothing{Enter}");

    expect(await screen.findByText("noMatchesTitle")).toBeVisible();
    expect(screen.queryByRole("button", { name: "emptyUpload" })).toBeNull();
  });

  it("removes deleted files from catalog and mounted DriveFilePicker on mixed-success bulk delete while GETs are held", async () => {
    const user = userEvent.setup();
    const fileKeep = makeFile("res_keep", "keep.pdf");
    const fileDrop = makeFile("res_drop", "drop.pdf");
    const fileFail = makeFile("res_fail", "fail.pdf");
    const pickerKeep = makePickerFile("keep.pdf");
    const pickerDrop = makePickerFile("drop.pdf");
    const pickerFail = makePickerFile("fail.pdf");
    const catalogRefetchDeferred = Promise.withResolvers<FileSearchPage>();
    const pickerRefetchDeferred = Promise.withResolvers<DriveItem[]>();
    const onSelect = vi.fn();

    api.fetchFileSearchPage
      .mockResolvedValueOnce({
        items: [fileKeep, fileDrop, fileFail],
        search: makeMeta({ windowCount: 3 }),
      })
      .mockImplementationOnce(() => catalogRefetchDeferred.promise);
    listDriveItemsMock
      .mockResolvedValueOnce([pickerKeep, pickerDrop, pickerFail])
      .mockImplementationOnce(() => pickerRefetchDeferred.promise);
    // drop.pdf succeeds; fail.pdf fails.
    api.deleteDriveUploads.mockResolvedValueOnce([fileFail.pathname!]);

    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 60_000,
          gcTime: Number.POSITIVE_INFINITY,
        },
        mutations: { gcTime: Number.POSITIVE_INFINITY },
      },
    });
    const orgBPickerKey = driveQueryKeys.picker(orgB);
    client.setQueryData(orgBPickerKey, [
      makePickerFile("drop.pdf", { pathname: "drive/orgs/org_b/drop.pdf" }),
    ]);

    const renderBoth = (pickerOpen: boolean) => (
      <QueryClientProvider client={client}>
        <DriveAllFilesPanel store={orgA} viewMode="list" isMobile={false} />
        <DriveFilePicker
          open={pickerOpen}
          onOpenChange={vi.fn()}
          onSelect={onSelect}
        />
      </QueryClientProvider>
    );

    const { rerender } = render(renderBoth(true));

    // Real DriveFilePicker loads through driveQueryKeys.picker(orgA).
    expect(
      await screen.findByRole("button", { name: /drop\.pdf/ }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: /fail\.pdf/ })).toBeEnabled();
    expect(client.getQueryData(driveQueryKeys.picker(orgA))).toHaveLength(3);

    // Close picker to interact with the All files catalog behind the modal.
    rerender(renderBoth(false));

    expect(await screen.findByText("drop.pdf")).toBeVisible();
    expect(screen.getByText("fail.pdf")).toBeVisible();

    await user.click(
      screen.getByRole("checkbox", { name: 'selectFile:{"name":"drop.pdf"}' }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: 'selectFile:{"name":"fail.pdf"}' }),
    );
    await user.click(screen.getByRole("button", { name: "bulkDelete" }));
    const deleteButtons = screen.getAllByRole("button", { name: "bulkDelete" });
    await user.click(deleteButtons[deleteButtons.length - 1]);

    // Before the catalog refetch returns: deleted row is gone, failed row stays checked & selectable.
    await waitFor(() => {
      expect(screen.queryByText("drop.pdf")).toBeNull();
    });
    expect(screen.getByText("keep.pdf")).toBeVisible();
    expect(screen.getByText("fail.pdf")).toBeVisible();
    const failCheckbox = screen.getByRole("checkbox", {
      name: 'selectFile:{"name":"fail.pdf"}',
    });
    expect(failCheckbox).toBeEnabled();
    expect(failCheckbox).toBeChecked();

    // Reopen the real DriveFilePicker while its refetch GET is held:
    // deleted row is already gone, and remaining rows are disabled while refetching.
    rerender(renderBoth(true));

    const keepPickerButton = await screen.findByRole("button", {
      name: /keep\.pdf/,
    });
    const failPickerButton = screen.getByRole("button", {
      name: /fail\.pdf/,
    });
    expect(
      screen.queryByRole("button", { name: /drop\.pdf/ }),
    ).not.toBeInTheDocument();
    expect(keepPickerButton).toBeDisabled();
    expect(failPickerButton).toBeDisabled();
    await user.click(failPickerButton);
    expect(onSelect).not.toHaveBeenCalled();

    // Other workspace picker cache stays untouched.
    expect(client.getQueryData(orgBPickerKey)).toHaveLength(1);
    expect(client.getQueryState(orgBPickerKey)?.isInvalidated).toBe(false);

    // Once refetch GETs resolve, picker rows re-enable and failed row is selectable.
    await act(async () => {
      catalogRefetchDeferred.resolve({
        items: [fileKeep, fileFail],
        search: makeMeta({ windowCount: 2 }),
      });
      pickerRefetchDeferred.resolve([pickerKeep, pickerFail]);
      await Promise.all([
        catalogRefetchDeferred.promise,
        pickerRefetchDeferred.promise,
      ]);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /fail\.pdf/ })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /fail\.pdf/ }));
    expect(onSelect).toHaveBeenCalledWith(pickerFail);
  });

  it("invalidates Drive without dropping failed items when every item in a bulk delete fails", async () => {
    const user = userEvent.setup();
    const fileA = makeFile("res_a", "a.pdf");
    const refetchDeferred = Promise.withResolvers<FileSearchPage>();

    api.fetchFileSearchPage
      .mockResolvedValueOnce({
        items: [fileA],
        search: makeMeta({ windowCount: 1 }),
      })
      .mockImplementationOnce(() => refetchDeferred.promise);
    api.deleteDriveUploads.mockResolvedValueOnce([fileA.pathname!]);

    const client = makeQueryClient();
    const pickerKey = driveQueryKeys.picker(orgA);
    client.setQueryData(pickerKey, [makePickerFile("a.pdf")]);

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
    await waitFor(() => {
      expect(api.fetchFileSearchPage).toHaveBeenCalledTimes(2);
    });
    // Failed delete still invalidates the prefix (Core may have removed a blob before failing),
    // without removing the failed row via deletedIds.
    expect(client.getQueryState(pickerKey)?.isInvalidated).toBe(true);
    expect(client.getQueryData(pickerKey)).toHaveLength(1);
    expect(screen.getByText("a.pdf")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: 'selectFile:{"name":"a.pdf"}' }),
    ).toBeChecked();

    await act(async () => {
      refetchDeferred.resolve({
        items: [fileA],
        search: makeMeta({ windowCount: 1 }),
      });
      await refetchDeferred.promise;
    });
  });

  it("offers Combine PDFs only when every selected file is an uploaded PDF", async () => {
    const user = userEvent.setup();
    api.fetchFileSearchPage.mockResolvedValueOnce({
      items: [
        makeFile("res_a", "a.pdf"),
        makeFile("res_b", "b.pdf"),
        makeFile("res_c", "c.png", { mimeType: "image/png" }),
      ],
      search: makeMeta({ windowCount: 3 }),
    });

    renderPanel();

    for (const name of ["a.pdf", "b.pdf"])
      await user.click(
        await screen.findByRole("checkbox", {
          name: `selectFile:{"name":"${name}"}`,
        }),
      );
    expect(
      screen.getByRole("button", { name: "bulkCombinePdf" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("checkbox", { name: 'selectFile:{"name":"c.png"}' }),
    );
    expect(
      screen.queryByRole("button", { name: "bulkCombinePdf" }),
    ).not.toBeInTheDocument();
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

  it("keeps loaded rows, hides Load more, and shows Retry calling refetch when a page-one refresh fails", async () => {
    const user = userEvent.setup();
    const file1 = makeFile("res_1", "kept.pdf");
    const refreshed = makeFile("res_2", "recovered.pdf");

    api.fetchFileSearchPage
      .mockResolvedValueOnce({
        items: [file1],
        search: makeMeta({ hasMore: true, nextCursor: "cursor_2" }),
      })
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce({
        items: [refreshed],
        search: makeMeta({ hasMore: true, nextCursor: "cursor_3" }),
      });

    const { client } = renderPanel();

    expect(await screen.findByText("kept.pdf")).toBeVisible();

    await act(async () => {
      await invalidateDrive(client, orgA);
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("searchError");
    expect(screen.getByText("kept.pdf")).toBeVisible();
    expect(screen.queryByRole("button", { name: "loadMore" })).toBeNull();
    const retry = screen.getByRole("button", { name: "retry" });
    expect(retry).toBeEnabled();

    await user.click(retry);

    expect(await screen.findByText("recovered.pdf")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "loadMore" })).toBeEnabled();
  });

  it("shows Retry instead of the empty state when deleting every loaded row is followed by a held-then-failed refresh", async () => {
    const user = userEvent.setup();
    const onlyFile = makeFile("res_only", "only.pdf");
    const recoveredFile = makeFile("res_recovered", "recovered.pdf");
    const refreshDeferred = Promise.withResolvers<FileSearchPage>();

    api.fetchFileSearchPage
      .mockResolvedValueOnce({
        items: [onlyFile],
        search: makeMeta({ windowCount: 1 }),
      })
      .mockImplementationOnce(() => refreshDeferred.promise)
      .mockResolvedValueOnce({
        items: [recoveredFile],
        search: makeMeta({ windowCount: 1 }),
      });
    api.deleteDriveUploads.mockResolvedValueOnce([]);

    renderPanel();

    expect(await screen.findByText("only.pdf")).toBeVisible();

    await user.click(
      screen.getByRole("checkbox", { name: 'selectFile:{"name":"only.pdf"}' }),
    );
    await user.click(screen.getByRole("button", { name: "bulkDelete" }));
    const deleteButtons = screen.getAllByRole("button", { name: "bulkDelete" });
    await user.click(deleteButtons[deleteButtons.length - 1]);

    // Deleted row disappears immediately while the refresh GET is held.
    await waitFor(() => {
      expect(screen.queryByText("only.pdf")).toBeNull();
    });
    expect(api.fetchFileSearchPage).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("emptyTitle")).toBeNull();

    // Failing the held refresh GET renders Retry, not the empty state.
    await act(async () => {
      refreshDeferred.reject(new Error("refresh failed"));
      await refreshDeferred.promise.catch(() => {});
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("searchError");
    expect(screen.queryByText("emptyTitle")).toBeNull();
    const retry = screen.getByRole("button", { name: "retry" });
    expect(retry).toBeEnabled();

    await user.click(retry);

    expect(await screen.findByText("recovered.pdf")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
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

describe("DriveAllFilesPanel folder README", () => {
  const readme = makeFile("res_readme", "README.md", {
    mimeType: "text/markdown",
  });

  beforeEach(() => {
    for (const fn of Object.values(api)) {
      fn.mockReset();
    }
    useSessionMock.mockReturnValue({
      data: {
        user: { id: "user_1" },
        session: { activeOrganizationId: "org_a" },
      },
    });
    api.fetchWorkspaceFolders.mockResolvedValue([]);
    api.fetchWorkspaceLabels.mockResolvedValue([] as WorkspaceLabel[]);
    api.fetchFileCollections.mockResolvedValue([] as FileCollection[]);
    // Page one of a long folder, sorted by name: README.md is not on it.
    api.fetchFileSearchPage.mockResolvedValue({
      items: [
        makeFile("res_a", "a-brief.pdf"),
        makeFile("res_b", "b-brief.pdf"),
      ],
      search: makeMeta({ hasMore: true, nextCursor: "page-2" }),
    } satisfies FileSearchPage);
    api.fetchFolderReadme.mockResolvedValue(readme);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Signed contracts go in /signed.")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the folder's README even when it is not on the first page of files", async () => {
    renderPanel({ initialFolder: "Client work" });

    expect(
      await screen.findByRole("region", { name: "readmeLabel" }),
    ).toHaveTextContent("Signed contracts go in /signed.");
    expect(api.fetchFolderReadme).toHaveBeenCalledWith(
      expect.objectContaining({ store: orgA, folder: "Client work" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/drive/files/res_readme/content?scope=org&organizationId=org_a",
      expect.anything(),
    );
    // Only page one is loaded: the card does not depend on the list.
    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
  });

  it("hides the README while searching the whole workspace", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("region", { name: "readmeLabel" });

    await user.type(screen.getByRole("searchbox"), "plan");

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "readmeLabel" })).toBeNull(),
    );
  });
});
