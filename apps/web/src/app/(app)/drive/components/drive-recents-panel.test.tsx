import type {
  DriveRecentsItem,
  FileCollection,
  FileResource,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveRecentsPageResult } from "@/lib/utils/drive-recents-list.client";
import type { FileSearchPage } from "@/lib/utils/file-search.client";

const api = vi.hoisted(() => ({
  fetchDriveRecentsPage: vi.fn(),
  fetchFileSearchPage: vi.fn(),
  fetchWorkspaceFolders: vi.fn(),
  fetchWorkspaceLabels: vi.fn(),
  fetchFileCollections: vi.fn(),
  updateFileCollection: vi.fn(),
}));

vi.mock("@/lib/utils/drive-recents-list.client", () => ({
  fetchDriveRecentsPage: (...args: unknown[]) =>
    api.fetchDriveRecentsPage(...args),
}));

vi.mock("@/lib/utils/file-search.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/utils/file-search.client")>();
  return {
    ...actual,
    fetchFileSearchPage: (...args: unknown[]) =>
      api.fetchFileSearchPage(...args),
    fetchWorkspaceFolders: (...args: unknown[]) =>
      api.fetchWorkspaceFolders(...args),
    fetchWorkspaceLabels: (...args: unknown[]) =>
      api.fetchWorkspaceLabels(...args),
    fetchFileCollections: (...args: unknown[]) =>
      api.fetchFileCollections(...args),
    updateFileCollection: (...args: unknown[]) =>
      api.updateFileCollection(...args),
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "Aug 25, 2026",
    number: (value: number) => String(value),
  }),
  useLocale: () => "en",
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({ locale: "en" }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
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
    onSelect,
    onClick,
    disabled,
    ...props
  }: {
    children: ReactNode;
    onSelect?: (event: { preventDefault: () => void }) => void;
    onClick?: () => void;
    disabled?: boolean;
  } & Record<string, unknown>) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onSelect?.({ preventDefault: () => undefined });
        onClick?.();
      }}
      {...props}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/app/drive/components/drive-file-viewer", () => ({
  DriveFileViewer: () => null,
}));

import { DriveAllFilesPanel } from "@/app/drive/components/drive-all-files-panel";
import { DriveRecentsPanel } from "@/app/drive/components/drive-recents-panel";
import { invalidateDrive } from "@/queries/drive";

const orgA = { scope: "org" as const, organizationId: "org_a" };
const orgB = { scope: "org" as const, organizationId: "org_b" };

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function makeRecentsFile(
  id: string,
  name: string,
  overrides: Partial<Extract<DriveRecentsItem, { kind: "drive-file" }>> = {},
): Extract<DriveRecentsItem, { kind: "drive-file" }> {
  return {
    kind: "drive-file",
    name,
    fileUrl: `https://example.com/drive/orgs/org_a/${name}`,
    pathname: `drive/orgs/org_a/${name}`,
    size: 512,
    activityAt: new Date("2026-08-25T10:00:00.000Z"),
    resourceId: id,
    category: null,
    tags: [],
    dataRoom: false,
    ...overrides,
  };
}

function makeCatalogFile(
  id: string,
  displayName: string,
  overrides: Partial<FileResource> = {},
): FileResource {
  return {
    id,
    displayName,
    sourceKind: "DRIVE_UPLOAD",
    mimeType: "application/pdf",
    sizeBytes: 512,
    pathname: `drive/orgs/org_a/${displayName}`,
    metadataRevision: 1,
    category: null,
    tags: [],
    projects: [],
    snippet: null,
    filenameMatch: false,
    ...overrides,
  } as unknown as FileResource;
}

function makeSearchPage(items: FileResource[]): FileSearchPage {
  return {
    items,
    search: {
      rankingMode: "deterministic",
      rankingFallback: null,
      resultWindowLimit: 120,
      windowCount: items.length,
      remainingWindowCount: 0,
      hasMore: false,
      nextCursor: null,
      truncated: false,
      restarted: false,
      indexCoverage: {
        indexed: items.length,
        processing: 0,
        unsupported: 0,
      },
    },
  } as unknown as FileSearchPage;
}

function makeCollection(id: string, name: string): FileCollection {
  return {
    id,
    name,
    isOwner: true,
    definition: { query: "", typeFamilies: ["document"] },
  } as unknown as FileCollection;
}

function renderRecents(
  props: Partial<Parameters<typeof DriveRecentsPanel>[0]> = {},
  client = makeQueryClient(),
) {
  const defaultProps: Parameters<typeof DriveRecentsPanel>[0] = {
    driveStore: orgA,
    searchQuery: "",
    tagLabelIds: [],
    onOpenMoveDialog: vi.fn(),
    onShareFile: vi.fn(),
    onOpenDeleteDialog: vi.fn(),
    onRenameFile: vi.fn().mockResolvedValue(undefined),
    onOpenCopyDialog: vi.fn(),
    onUpload: vi.fn(),
    uploading: false,
    onOpenWorkspace: vi.fn(),
    ...props,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <DriveRecentsPanel {...defaultProps} />
    </QueryClientProvider>,
  );
  return { ...view, client, props: defaultProps };
}

describe("DriveRecentsPanel", () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) {
      mock.mockReset();
    }
    api.fetchDriveRecentsPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    api.fetchFileSearchPage.mockResolvedValue(makeSearchPage([]));
    api.fetchWorkspaceFolders.mockResolvedValue([]);
    api.fetchWorkspaceLabels.mockResolvedValue([]);
    api.fetchFileCollections.mockResolvedValue([]);
  });

  it("updates recents after a rename in the catalog and updates the catalog after a rename in recents", async () => {
    const user = userEvent.setup();
    const client = makeQueryClient();
    const initialCollection = makeCollection("col_1", "Invoices");
    const renamedCollection = makeCollection("col_1", "Receipts");

    api.fetchFileCollections
      .mockResolvedValueOnce([initialCollection])
      .mockResolvedValue([renamedCollection]);
    api.updateFileCollection.mockResolvedValue(renamedCollection);

    api.fetchFileSearchPage
      .mockResolvedValueOnce(
        makeSearchPage([makeCatalogFile("res_1", "draft.pdf")]),
      )
      .mockResolvedValueOnce(
        makeSearchPage([makeCatalogFile("res_1", "after-catalog-rename.pdf")]),
      )
      .mockResolvedValueOnce(
        makeSearchPage([makeCatalogFile("res_1", "after-recents-rename.pdf")]),
      );

    api.fetchDriveRecentsPage
      .mockResolvedValueOnce({
        items: [makeRecentsFile("res_1", "draft.pdf")],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: [makeRecentsFile("res_1", "after-catalog-rename.pdf")],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: [makeRecentsFile("res_1", "after-recents-rename.pdf")],
        nextCursor: null,
      });

    vi.stubGlobal("prompt", () => "Receipts");

    const onRenameFile = vi.fn(async () => {
      void invalidateDrive(client, orgA);
    });

    render(
      <QueryClientProvider client={client}>
        <section aria-label="catalog">
          <DriveAllFilesPanel store={orgA} viewMode="list" isMobile={false} />
        </section>
        <section aria-label="recents">
          <DriveRecentsPanel
            driveStore={orgA}
            searchQuery=""
            tagLabelIds={[]}
            onOpenMoveDialog={vi.fn()}
            onShareFile={vi.fn()}
            onOpenDeleteDialog={vi.fn()}
            onRenameFile={onRenameFile}
            onOpenCopyDialog={vi.fn()}
            onUpload={vi.fn()}
            uploading={false}
            onOpenWorkspace={vi.fn()}
          />
        </section>
      </QueryClientProvider>,
    );

    const catalog = screen.getByRole("region", { name: "catalog" });
    const recents = screen.getByRole("region", { name: "recents" });

    expect(await within(catalog).findByText("draft.pdf")).toBeVisible();
    expect(await within(recents).findByText("draft.pdf")).toBeVisible();

    // 1. Rename started in the catalog updates recents.
    await user.click(
      within(catalog).getByRole("button", { name: "collectionRename" }),
    );

    expect(
      await within(recents).findByText("after-catalog-rename.pdf"),
    ).toBeVisible();
    expect(
      await within(catalog).findByText("after-catalog-rename.pdf"),
    ).toBeVisible();

    // 2. Rename started in recents updates the catalog.
    await user.click(
      within(recents).getByRole("button", { name: "renameAction" }),
    );
    const renameInput = within(recents).getByRole("textbox");
    await user.clear(renameInput);
    await user.type(renameInput, "after-recents-rename.pdf{Enter}");

    expect(onRenameFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "after-catalog-rename.pdf" }),
      "after-recents-rename.pdf",
    );
    expect(
      await within(catalog).findByText("after-recents-rename.pdf"),
    ).toBeVisible();
    expect(
      await within(recents).findByText("after-recents-rename.pdf"),
    ).toBeVisible();

    vi.unstubAllGlobals();
  });

  it("disables Load more while page one refreshes and deduplicates appended pages", async () => {
    const user = userEvent.setup();
    const firstFile = makeRecentsFile("res_1", "first.pdf", {
      activityAt: new Date("2026-08-25T12:00:00.000Z"),
    });
    const secondFile = makeRecentsFile("res_2", "second.pdf", {
      activityAt: new Date("2026-08-25T11:00:00.000Z"),
    });
    const refreshDeferred = Promise.withResolvers<DriveRecentsPageResult>();

    api.fetchDriveRecentsPage
      .mockResolvedValueOnce({
        items: [firstFile],
        nextCursor: "cursor_2",
      })
      .mockImplementationOnce(() => refreshDeferred.promise)
      .mockResolvedValueOnce({
        items: [firstFile, secondFile],
        nextCursor: null,
      });

    const { client } = renderRecents();

    expect(await screen.findByText("first.pdf")).toBeVisible();
    const loadMore = screen.getByRole("button", { name: "loadMore" });
    expect(loadMore).toBeEnabled();

    await act(async () => {
      void invalidateDrive(client, orgA);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "loadMore" })).toBeDisabled();
    });
    expect(screen.getByText("first.pdf")).toBeVisible();

    await act(async () => {
      refreshDeferred.resolve({
        items: [firstFile],
        nextCursor: "cursor_2",
      });
      await refreshDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "loadMore" })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: "loadMore" }));

    expect(await screen.findByText("second.pdf")).toBeVisible();
    expect(screen.getAllByText("first.pdf")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "loadMore" })).toBeNull();
  });

  it("keeps loaded rows and shows Retry when Load more fails", async () => {
    const user = userEvent.setup();
    const firstFile = makeRecentsFile("res_1", "first.pdf");
    const secondFile = makeRecentsFile("res_2", "second.pdf");

    api.fetchDriveRecentsPage
      .mockResolvedValueOnce({
        items: [firstFile],
        nextCursor: "cursor_2",
      })
      .mockRejectedValueOnce(new Error("page 2 failed"))
      .mockResolvedValueOnce({
        items: [secondFile],
        nextCursor: null,
      });

    renderRecents();

    expect(await screen.findByText("first.pdf")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "loadMore" }));

    const retry = await screen.findByRole("button", { name: "Files.retry" });
    expect(screen.getByText("first.pdf")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("loadMoreRecentsError");
    expect(screen.queryByRole("button", { name: "loadMore" })).toBeNull();

    await user.click(retry);

    expect(await screen.findByText("second.pdf")).toBeVisible();
    expect(screen.getByText("first.pdf")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Files.retry" })).toBeNull();
  });

  it("keeps loaded rows, hides Load more, and shows Retry when a page-one refresh fails", async () => {
    const user = userEvent.setup();
    const firstFile = makeRecentsFile("res_1", "first.pdf");
    const updatedFile = makeRecentsFile("res_1", "updated.pdf");

    api.fetchDriveRecentsPage
      .mockResolvedValueOnce({
        items: [firstFile],
        nextCursor: "cursor_2",
      })
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce({
        items: [updatedFile],
        nextCursor: "cursor_2",
      });

    const { client } = renderRecents();

    expect(await screen.findByText("first.pdf")).toBeVisible();
    expect(screen.getByRole("button", { name: "loadMore" })).toBeVisible();

    await act(async () => {
      await invalidateDrive(client, orgA);
    });

    const retry = await screen.findByRole("button", { name: "Files.retry" });
    expect(screen.getByText("first.pdf")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("loadRecentsError");
    expect(screen.queryByRole("button", { name: "loadMore" })).toBeNull();

    await user.click(retry);

    expect(await screen.findByText("updated.pdf")).toBeVisible();
    expect(screen.getByRole("button", { name: "loadMore" })).toBeVisible();
  });

  it("shows Retry on initial load failure and recovers on retry", async () => {
    const user = userEvent.setup();
    const recoveredFile = makeRecentsFile("res_1", "recovered.pdf");

    api.fetchDriveRecentsPage
      .mockRejectedValueOnce(new Error("initial load failed"))
      .mockResolvedValueOnce({
        items: [recoveredFile],
        nextCursor: null,
      });

    renderRecents();

    const retry = await screen.findByRole("button", { name: "Files.retry" });
    expect(screen.getByRole("alert")).toHaveTextContent("loadRecentsError");

    await user.click(retry);

    expect(await screen.findByText("recovered.pdf")).toBeVisible();
  });

  it("removes a deleted file immediately before the refetch returns", async () => {
    const keepFile = makeRecentsFile("res_keep", "keep.pdf");
    const deleteFile = makeRecentsFile("res_del", "delete-me.pdf");
    const refetchDeferred = Promise.withResolvers<DriveRecentsPageResult>();

    api.fetchDriveRecentsPage
      .mockResolvedValueOnce({
        items: [keepFile, deleteFile],
        nextCursor: null,
      })
      .mockImplementationOnce(() => refetchDeferred.promise);

    const { client } = renderRecents();

    expect(await screen.findByText("keep.pdf")).toBeVisible();
    expect(screen.getByText("delete-me.pdf")).toBeVisible();

    await act(async () => {
      void invalidateDrive(client, orgA, {
        deletedIds: [deleteFile.pathname],
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("delete-me.pdf")).toBeNull();
    });
    expect(screen.getByText("keep.pdf")).toBeVisible();

    await act(async () => {
      refetchDeferred.resolve({ items: [keepFile], nextCursor: null });
      await refetchDeferred.promise;
    });

    expect(screen.getByText("keep.pdf")).toBeVisible();
    expect(screen.queryByText("delete-me.pdf")).toBeNull();
  });

  it("never renders a late workspace A response under workspace B", async () => {
    const orgADeferred = Promise.withResolvers<DriveRecentsPageResult>();
    const orgBFile = makeRecentsFile("res_b", "org-b.pdf", {
      pathname: "drive/orgs/org_b/org-b.pdf",
    });

    api.fetchDriveRecentsPage
      .mockImplementationOnce(() => orgADeferred.promise)
      .mockResolvedValueOnce({
        items: [orgBFile],
        nextCursor: null,
      });

    const client = makeQueryClient();
    const { rerender, props } = renderRecents({ driveStore: orgA }, client);

    await waitFor(() => {
      expect(api.fetchDriveRecentsPage).toHaveBeenCalledTimes(1);
    });

    rerender(
      <QueryClientProvider client={client}>
        <DriveRecentsPanel {...props} driveStore={orgB} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("org-b.pdf")).toBeVisible();

    await act(async () => {
      orgADeferred.resolve({
        items: [makeRecentsFile("res_a", "org-a.pdf")],
        nextCursor: null,
      });
      await orgADeferred.promise;
    });

    expect(screen.queryByText("org-a.pdf")).toBeNull();
    expect(screen.getByText("org-b.pdf")).toBeVisible();
  });
});
