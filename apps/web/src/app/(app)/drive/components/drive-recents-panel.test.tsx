import type { DriveRecentsItem, FileResource } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
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
  fetchDataRooms: vi.fn(),
  patchDriveFoldersRename: vi.fn(),
  patchDriveFilesRename: vi.fn(),
  getUsersByIdOrganizations: vi.fn(),
}));

const useSessionMock = vi.hoisted(() => vi.fn());

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
  };
});

vi.mock("@/lib/utils/data-room.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/data-room.client")>()),
  fetchDataRooms: (...args: unknown[]) => api.fetchDataRooms(...args),
}));

vi.mock("@sokosumi/core-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/core-client")>()),
  getUsersByIdOrganizations: (...args: unknown[]) =>
    api.getUsersByIdOrganizations(...args),
  patchDriveFoldersRename: (...args: unknown[]) =>
    api.patchDriveFoldersRename(...args),
  patchDriveFilesRename: (...args: unknown[]) =>
    api.patchDriveFilesRename(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({ id: "browser-core-client" }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("@/hooks/effects/use-mobile", () => ({
  useIsMobile: () => false,
  useIsMobileMedia: () => false,
  MOBILE_BREAKPOINT: 768,
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({ NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 0 }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/drive",
}));

vi.mock("next-intl", () => ({
  useTimeZone: () => "UTC",
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
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
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

import { DriveRecentsPanel } from "@/app/drive/components/drive-recents-panel";
import { DrivePageClient } from "@/app/drive/drive-page-client";
import { invalidateDrive } from "@/queries/drive";

const orgA = { scope: "org" as const, organizationId: "org_a" };
const orgB = { scope: "org" as const, organizationId: "org_b" };

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000,
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

function makeRecentsTable(
  tableId: string,
  name: string,
): Extract<DriveRecentsItem, { kind: "table" }> {
  return {
    kind: "table",
    tableId,
    name,
    activityAt: new Date("2026-08-25T10:00:00.000Z"),
    projectId: null,
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
      truncated: false,
      hasMore: false,
      nextCursor: null,
      restarted: false,
      indexCoverage: {
        indexed: items.length,
        processing: 0,
        unsupported: 0,
      },
    },
  } as unknown as FileSearchPage;
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
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      data: {
        user: { id: "user_1" },
        session: { activeOrganizationId: "org_a" },
      },
    });
    api.fetchDriveRecentsPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    api.fetchFileSearchPage.mockResolvedValue(makeSearchPage([]));
    api.fetchWorkspaceFolders.mockResolvedValue([]);
    api.fetchWorkspaceLabels.mockResolvedValue([]);
    api.fetchFileCollections.mockResolvedValue([]);
    api.fetchDataRooms.mockResolvedValue([]);
    api.getUsersByIdOrganizations.mockResolvedValue({
      data: { data: [{ id: "org_a", name: "Org A" }] },
    });
  });

  it("updates recents after a folder rename in the catalog and updates the catalog after a file rename in recents", async () => {
    const user = userEvent.setup();
    const client = makeQueryClient();

    // Stateful fake Drive backend: reads derive strictly from successful writes.
    const driveState = {
      folder: "Reports",
      fileName: "draft.pdf",
    };
    const currentPathname = () =>
      `drive/orgs/org_a/${driveState.folder}/${driveState.fileName}`;

    api.fetchWorkspaceFolders.mockImplementation(async () => [
      driveState.folder,
    ]);
    api.fetchFileSearchPage.mockImplementation(
      async ({ filters }: { filters: { folder: string } }) => {
        if (filters.folder === driveState.folder) {
          return makeSearchPage([
            makeCatalogFile("res_1", driveState.fileName, {
              pathname: currentPathname(),
            }),
          ]);
        }
        return makeSearchPage([]);
      },
    );
    api.fetchDriveRecentsPage.mockImplementation(async () => ({
      items: [
        makeRecentsFile("res_1", driveState.fileName, {
          pathname: currentPathname(),
          fileUrl: `https://example.com/${currentPathname()}`,
        }),
      ],
      nextCursor: null,
    }));
    api.patchDriveFoldersRename.mockImplementation(
      async ({
        body,
      }: {
        body: { oldFolderPath: string; newFolderPath: string };
      }) => {
        if (body.oldFolderPath !== driveState.folder) {
          throw new Error(`Unexpected folder ${body.oldFolderPath}`);
        }
        driveState.folder = body.newFolderPath;
        return { data: {} };
      },
    );
    api.patchDriveFilesRename.mockImplementation(
      async ({
        body,
      }: {
        body: { oldPathname: string; newFilename: string };
      }) => {
        if (body.oldPathname !== currentPathname()) {
          throw new Error(
            `Stale file pathname ${body.oldPathname} (expected ${currentPathname()})`,
          );
        }
        driveState.fileName = body.newFilename;
        return { data: {} };
      },
    );

    vi.stubGlobal("prompt", () => "Investors");

    render(
      <NuqsTestingAdapter searchParams="" hasMemory>
        <QueryClientProvider client={client}>
          <DrivePageClient defaultFilesViewMode="list" />
        </QueryClientProvider>
      </NuqsTestingAdapter>,
    );

    // 1. Recents initially loads the file under Reports.
    expect(await screen.findByText("draft.pdf")).toBeVisible();

    // 2. Switch to Workspace catalog, open Reports, and rename it to Investors.
    await user.click(screen.getByRole("tab", { name: "workspaceTab" }));
    await user.click(await screen.findByRole("button", { name: "Reports" }));
    expect(await screen.findByText("draft.pdf")).toBeVisible();

    await user.click(screen.getByTestId("files-rename-folder"));

    await waitFor(() => {
      expect(api.patchDriveFoldersRename).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            oldFolderPath: "Reports",
            newFolderPath: "Investors",
          }),
        }),
      );
    });
    expect(
      await screen.findByRole("button", { name: "Investors" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reports" })).toBeNull();
    expect(await screen.findByText("draft.pdf")).toBeVisible();

    // 3. Return to Recents and rename draft.pdf -> final.pdf through the real handler.
    //    This only succeeds if Recents refreshed to the renamed Investors pathname.
    await user.click(screen.getByRole("tab", { name: "recentsTab" }));
    await waitFor(() => {
      expect(api.fetchDriveRecentsPage).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("draft.pdf")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "renameAction" }));
    const renameInput = screen.getByDisplayValue("draft.pdf");
    await user.clear(renameInput);
    await user.type(renameInput, "final.pdf{Enter}");

    await waitFor(() => {
      expect(api.patchDriveFilesRename).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            oldPathname: "drive/orgs/org_a/Investors/draft.pdf",
            newFilename: "final.pdf",
          },
        }),
      );
    });
    expect(await screen.findByText("final.pdf")).toBeVisible();
    expect(screen.queryByText("draft.pdf")).toBeNull();

    // 4. Return to Workspace catalog and reopen Investors (which was cached with staleTime: 60_000).
    await user.click(screen.getByRole("tab", { name: "workspaceTab" }));
    await user.click(await screen.findByRole("button", { name: "Investors" }));

    expect(await screen.findByText("final.pdf")).toBeVisible();
    expect(screen.queryByText("draft.pdf")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("shows cached rows and refetches on return to Recents after a table rename", async () => {
    const client = makeQueryClient();
    const refetchDeferred = Promise.withResolvers<DriveRecentsPageResult>();

    api.fetchDriveRecentsPage
      .mockResolvedValueOnce({
        items: [makeRecentsTable("table_1", "Leads")],
        nextCursor: null,
      })
      .mockImplementationOnce(() => refetchDeferred.promise);

    const { unmount } = renderRecents({}, client);

    expect(await screen.findByRole("link", { name: /Leads/ })).toBeVisible();

    // User opens the table editor, renames the table, and returns to Drive.
    unmount();

    renderRecents({}, client);

    // Cached row stays visible immediately while the background refetch runs.
    expect(screen.getByRole("link", { name: /Leads/ })).toBeVisible();
    await waitFor(() => {
      expect(api.fetchDriveRecentsPage).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      refetchDeferred.resolve({
        items: [makeRecentsTable("table_1", "Qualified Leads")],
        nextCursor: null,
      });
      await refetchDeferred.promise;
    });

    expect(
      await screen.findByRole("link", { name: /Qualified Leads/ }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: /^Leads$/ })).toBeNull();
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
