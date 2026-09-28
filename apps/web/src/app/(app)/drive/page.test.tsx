import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useSessionMock = vi.fn();
const listDriveItemsMock = vi.fn();
const patchDriveFoldersRenameMock = vi.fn();
const getUsersByIdOrganizationsMock = vi.fn();
const replaceMock = vi.fn();
const pushMock = vi.fn();
const useIsMobileMock = vi.fn(() => false);

let searchParams = new URLSearchParams();

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => useIsMobileMock(),
  useIsMobileMedia: () => useIsMobileMock(),
  MOBILE_BREAKPOINT: 768,
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({ NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 0 }),
}));

function translate(key: string) {
  return key;
}

const formatDateTime = () => "Aug 25, 2026";
const formatNumber = (value: number) => String(value);

vi.mock("next-intl", () => ({
  useTimeZone: () => "UTC",
  useTranslations: () => translate,
  useFormatter: () => ({
    dateTime: formatDateTime,
    number: formatNumber,
  }),
  useLocale: () => "en",
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
    disabled,
    ...props
  }: {
    children: ReactNode;
    onSelect?: (event: { preventDefault: () => void }) => void;
    disabled?: boolean;
  } & Record<string, unknown>) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect?.({ preventDefault: () => undefined })}
      {...props}
    >
      {children}
    </button>
  ),
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange,
    onSelect,
    ...props
  }: {
    children: ReactNode;
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    onSelect?: (event: { preventDefault: () => void }) => void;
  } & Record<string, unknown>) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => {
        onCheckedChange?.(true);
        onSelect?.({ preventDefault: () => undefined });
      }}
      {...props}
    >
      {children}
    </button>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
  }),
  useSearchParams: () => searchParams,
  usePathname: () => "/drive",
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/contexts/breadcrumb-override-context", () => ({
  useRegisterBreadcrumbOverride: () => undefined,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: (...args: unknown[]) => useSessionMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({ id: "browser-core-client" }),
}));

vi.mock("@/lib/clients/generated/core", () => ({
  deleteDriveFilesDelete: vi.fn(),
  deleteDriveFoldersDelete: vi.fn(),
  getUsersByIdOrganizations: (...args: unknown[]) =>
    getUsersByIdOrganizationsMock(...args),
  patchDriveFilesMove: vi.fn(),
  patchDriveFilesRename: vi.fn(),
  patchDriveFoldersRename: (...args: unknown[]) =>
    patchDriveFoldersRenameMock(...args),
  postDriveFolders: vi.fn(),
}));

vi.mock("@/lib/utils/drive-file-list.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/utils/drive-file-list.client")>();
  return {
    ...actual,
    listDriveItems: (...args: unknown[]) => listDriveItemsMock(...args),
  };
});

const fetchDriveTasksPageMock = vi.fn();
const fetchDriveRecentsPageMock = vi.fn();

vi.mock("@/lib/utils/drive-tasks-list.client", () => ({
  fetchDriveTasksPage: (...args: unknown[]) => fetchDriveTasksPageMock(...args),
}));

vi.mock("@/lib/utils/drive-recents-list.client", () => ({
  fetchDriveRecentsPage: (...args: unknown[]) =>
    fetchDriveRecentsPageMock(...args),
}));

vi.mock("@/app/drive/components/drive-tasks-filters", () => ({
  DriveTasksFilters: ({
    hideMobileTrigger,
    sheetOpen,
    onSheetOpenChange,
  }: {
    hideMobileTrigger?: boolean;
    sheetOpen?: boolean;
    onSheetOpenChange?: (open: boolean) => void;
  }) => {
    const { createPortal } = require("react-dom") as typeof import("react-dom");
    return (
      <>
        {!hideMobileTrigger ? (
          <button
            type="button"
            aria-label="filterTitle"
            onClick={() => onSheetOpenChange?.(true)}
          >
            filterTitle
          </button>
        ) : null}
        {sheetOpen
          ? createPortal(
              <div role="dialog" aria-label="filterTitle">
                filter sheet
              </div>,
              document.body,
            )
          : null}
      </>
    );
  },
}));

const listDataTablesMock = vi.fn();

vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: {
    list: (...args: unknown[]) => listDataTablesMock(...args),
  },
}));

/**
 * Stands in for the shared `FilterDropdownMenu` the real control wraps, the
 * way `drive-tasks-filters` is stubbed above: these tests are about where the
 * control lives and what it drives, not about the dropdown's internals.
 */
vi.mock("@/app/drive/components/drive-tables-filters", () => ({
  DriveTablesFilters: ({
    archived,
    onArchivedChange,
  }: {
    archived: boolean;
    onArchivedChange: (archived: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="tables-archived-filter"
      data-archived={archived ? "true" : "false"}
      onClick={() => onArchivedChange(!archived)}
    >
      filterStatusLabel
    </button>
  ),
}));

/**
 * The catalog panel, stubbed.
 *
 * It renders at the Workspace root now, and these cases are about the page
 * shell — which tab is selected, which controls sit in the header row, what the
 * folder listing does. The real panel fetches through the generated client and
 * imports enough of the app that the worker aborts before it mounts
 * (`drive-all-files-panel.a11y.test.ts` documents the same measurement), so a
 * marker is what the shell needs to assert against.
 */
vi.mock("@/app/drive/components/drive-all-files-panel", () => ({
  DriveAllFilesPanel: ({ initialQuery }: { initialQuery?: string }) => (
    <div
      data-testid="drive-all-files"
      data-initial-query={initialQuery ?? ""}
    />
  ),
}));

vi.mock("@/components/ui/image-viewer", () => ({
  ImageViewer: ({
    images,
    activeSrc,
  }: {
    images: { src: string; alt: string }[];
    activeSrc: string | null;
  }) => {
    const active = images.find((image) => image.src === activeSrc);
    return active ? <div role="dialog" aria-label={active.alt} /> : null;
  },
}));

vi.mock("@/components/ui/document-viewer", () => ({
  DocumentViewer: ({ open, fileName }: { open: boolean; fileName: string }) =>
    open ? <div role="dialog" aria-label={fileName} /> : null,
}));

import { DrivePageClient } from "@/app/drive/drive-page-client";
import {
  type FilesViewMode,
  parseFilesViewModeCookieHeader,
  resolveFilesViewModeFromClientCookie,
} from "@/lib/ui-preferences/files-view-mode";

function createDriveQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000,
      },
    },
  });
}

let queryClient = createDriveQueryClient();

function driveTree(defaultFilesViewMode: FilesViewMode = "list") {
  return (
    <NuqsTestingAdapter searchParams={searchParams} hasMemory>
      <QueryClientProvider client={queryClient}>
        <DrivePageClient defaultFilesViewMode={defaultFilesViewMode} />
      </QueryClientProvider>
    </NuqsTestingAdapter>
  );
}

function renderDrive(defaultFilesViewMode?: FilesViewMode) {
  return render(driveTree(defaultFilesViewMode));
}

function reportsFolder() {
  return {
    type: "folder" as const,
    name: "Reports",
    path: "Reports",
  };
}

function sessionFor(activeOrganizationId: string | null) {
  return {
    data: {
      user: { id: "user_1" },
      session: { activeOrganizationId },
    },
  };
}

function pendingSession() {
  return { data: null, isPending: true };
}

function listedStore() {
  const options = listDriveItemsMock.mock.calls.at(-1)?.[0] as {
    scope: string;
    organizationId?: string;
  };
  return options;
}

describe("DrivePage workspace remount", () => {
  beforeEach(() => {
    queryClient = createDriveQueryClient();
    searchParams = new URLSearchParams("view=browse");
    replaceMock.mockReset();
    pushMock.mockReset();
    useSessionMock.mockReset();
    listDriveItemsMock.mockReset();
    patchDriveFoldersRenameMock.mockReset();
    getUsersByIdOrganizationsMock.mockReset();
    fetchDriveTasksPageMock.mockReset();
    fetchDriveRecentsPageMock.mockReset();
    useIsMobileMock.mockReset();
    useIsMobileMock.mockReturnValue(false);

    fetchDriveTasksPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    fetchDriveRecentsPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    listDriveItemsMock.mockResolvedValue([reportsFolder()]);
    patchDriveFoldersRenameMock.mockResolvedValue({});
    getUsersByIdOrganizationsMock.mockResolvedValue({
      data: {
        data: [
          { id: "org_a", name: "Org A" },
          { id: "org_b", name: "Org B" },
        ],
      },
    });
  });

  it("cancels a pending folder rename when the active organization changes", async () => {
    const user = userEvent.setup();
    useSessionMock.mockReturnValue(sessionFor("org_a"));

    const { rerender } = renderDrive();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: /renameAction/i }));

    expect(screen.getByDisplayValue("Reports")).toBeVisible();
    expect(screen.getByTitle("saveAction")).toBeVisible();

    useSessionMock.mockReturnValue(sessionFor("org_b"));
    rerender(driveTree());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    });

    expect(screen.queryByTitle("saveAction")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Reports")).not.toBeInTheDocument();
    expect(patchDriveFoldersRenameMock).not.toHaveBeenCalled();
  });

  it("drops the folder query when the active organization changes", async () => {
    searchParams = new URLSearchParams("view=browse&folder=Reports");
    useSessionMock.mockReturnValue(sessionFor("org_a"));

    const { rerender } = renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });
    expect(replaceMock).not.toHaveBeenCalled();

    useSessionMock.mockReturnValue(sessionFor("org_b"));
    rerender(driveTree());

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/drive");
    });
  });

  it("does not mount personal drive while the session is pending", async () => {
    useSessionMock.mockReturnValue(pendingSession());

    const { rerender } = renderDrive();

    expect(listDriveItemsMock).not.toHaveBeenCalled();

    useSessionMock.mockReturnValue(sessionFor("org_a"));
    rerender(driveTree());

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    expect(listedStore()).toMatchObject({
      scope: "org",
      organizationId: "org_a",
    });
    expect(listDriveItemsMock).toHaveBeenCalledTimes(1);
  });

  it("does not remount as personal when the session briefly goes pending", async () => {
    useSessionMock.mockReturnValue(sessionFor("org_a"));

    const { rerender } = renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });
    const callsAfterFirstLoad = listDriveItemsMock.mock.calls.length;

    useSessionMock.mockReturnValue(pendingSession());
    rerender(driveTree());
    useSessionMock.mockReturnValue(sessionFor("org_a"));
    rerender(driveTree());

    expect(listDriveItemsMock).toHaveBeenCalledTimes(callsAfterFirstLoad);
    expect(
      listDriveItemsMock.mock.calls.every(
        ([options]) =>
          (options as { scope: string }).scope === "org" &&
          (options as { organizationId?: string }).organizationId === "org_a",
      ),
    ).toBe(true);
  });

  it("does not refetch the same workspace after a refresh remount", async () => {
    useSessionMock.mockReturnValue(sessionFor("org_a"));

    const { rerender, unmount } = renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalledTimes(1);
    });

    useSessionMock.mockReturnValue(sessionFor("org_b"));
    rerender(driveTree());

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalledTimes(2);
    });
    expect(listedStore()).toMatchObject({
      scope: "org",
      organizationId: "org_b",
    });

    unmount();
    useSessionMock.mockReturnValue(sessionFor("org_b"));
    renderDrive();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    });

    expect(listDriveItemsMock).toHaveBeenCalledTimes(2);
    expect(
      listDriveItemsMock.mock.calls.filter(
        ([options]) =>
          (options as { organizationId?: string }).organizationId === "org_b",
      ),
    ).toHaveLength(1);
  });

  it("ignores a stale move-folder list after the workspace changes", async () => {
    const user = userEvent.setup();
    const orgAOnly = {
      type: "folder" as const,
      name: "OrgAOnly",
      path: "OrgAOnly",
    };
    const orgBOnly = {
      type: "folder" as const,
      name: "OrgBOnly",
      path: "OrgBOnly",
    };
    let resolveOrgAFolders: ((items: (typeof orgAOnly)[]) => void) | undefined;
    let listCalls = 0;

    listDriveItemsMock.mockImplementation(() => {
      listCalls += 1;
      if (listCalls === 1) {
        return Promise.resolve([reportsFolder()]);
      }
      if (listCalls === 2) {
        return new Promise<(typeof orgAOnly)[]>((resolve) => {
          resolveOrgAFolders = resolve;
        });
      }
      if (listCalls === 3) {
        return Promise.resolve([reportsFolder()]);
      }
      return Promise.resolve([orgBOnly]);
    });

    useSessionMock.mockReturnValue(sessionFor("org_a"));
    const { rerender } = renderDrive();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: /moveAction/i }));
    expect(screen.getByText("loadingFolders")).toBeVisible();

    useSessionMock.mockReturnValue(sessionFor("org_b"));
    rerender(driveTree());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: /moveAction/i }));

    await waitFor(() => {
      expect(screen.getByText("OrgBOnly")).toBeVisible();
    });

    await act(async () => {
      resolveOrgAFolders?.([orgAOnly]);
    });

    expect(screen.queryByText("OrgAOnly")).not.toBeInTheDocument();
    expect(screen.getByText("OrgBOnly")).toBeVisible();
  });
});

describe("DrivePage tasks mobile toolbar", () => {
  beforeEach(() => {
    queryClient = createDriveQueryClient();
    searchParams = new URLSearchParams("view=tasks");
    replaceMock.mockReset();
    pushMock.mockReset();
    useSessionMock.mockReset();
    listDriveItemsMock.mockReset();
    fetchDriveTasksPageMock.mockReset();
    fetchDriveRecentsPageMock.mockReset();
    getUsersByIdOrganizationsMock.mockReset();
    useIsMobileMock.mockReset();
    useIsMobileMock.mockReturnValue(false);

    fetchDriveTasksPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    fetchDriveRecentsPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    getUsersByIdOrganizationsMock.mockResolvedValue({
      data: {
        data: [{ id: "org_a", name: "Org A" }],
      },
    });
    useSessionMock.mockReturnValue(sessionFor("org_a"));
  });

  it("keeps recents and browse tabs visible in tasks view", async () => {
    renderDrive();

    await waitFor(() => {
      expect(fetchDriveTasksPageMock).toHaveBeenCalled();
    });

    expect(screen.getByRole("tab", { name: "recentsTab" })).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "workspaceTab" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  });

  it("places the tasks actions menu beside the mobile search input", async () => {
    renderDrive();

    await waitFor(() => {
      expect(fetchDriveTasksPageMock).toHaveBeenCalled();
    });

    const mobileToolbar = screen.getByTestId("tasks-mobile-toolbar");
    expect(
      within(mobileToolbar).getByPlaceholderText("tasksSearchPlaceholder"),
    ).toBeVisible();
    expect(
      within(mobileToolbar).getByTestId("tasks-mobile-actions"),
    ).toBeVisible();
  });

  it("tasks mobile actions menu exposes sort and opens filter drawer", async () => {
    const user = userEvent.setup();

    renderDrive();

    await waitFor(() => {
      expect(fetchDriveTasksPageMock).toHaveBeenCalled();
    });

    await user.click(screen.getByTestId("tasks-mobile-actions"));
    expect(screen.getByTestId("tasks-mobile-sort-name")).toBeVisible();
    expect(screen.getByTestId("tasks-mobile-filter")).toHaveTextContent(
      "filterTitle",
    );

    await user.click(screen.getByTestId("tasks-mobile-filter"));
    expect(screen.getByRole("dialog", { name: "filterTitle" })).toBeVisible();
  });
});

describe("DrivePage recents view", () => {
  beforeEach(() => {
    queryClient = createDriveQueryClient();
    searchParams = new URLSearchParams();
    replaceMock.mockReset();
    pushMock.mockReset();
    useSessionMock.mockReset();
    listDriveItemsMock.mockReset();
    fetchDriveTasksPageMock.mockReset();
    fetchDriveRecentsPageMock.mockReset();
    getUsersByIdOrganizationsMock.mockReset();
    useIsMobileMock.mockReset();
    useIsMobileMock.mockReturnValue(false);

    fetchDriveTasksPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    fetchDriveRecentsPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    getUsersByIdOrganizationsMock.mockResolvedValue({
      data: {
        data: [{ id: "org_a", name: "Org A" }],
      },
    });
    useSessionMock.mockReturnValue(sessionFor("org_a"));
  });

  it("loads recents by default and shows search without browse actions", async () => {
    renderDrive();

    await waitFor(() => {
      expect(fetchDriveRecentsPageMock).toHaveBeenCalled();
    });

    expect(listDriveItemsMock).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "recentsTab" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("recentsEmptyTitle")).toBeVisible();
    expect(screen.getAllByPlaceholderText("searchPlaceholder")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "createFolder" }),
    ).not.toBeInTheDocument();
  });

  it("passes search query to recents fetch", async () => {
    const user = userEvent.setup();
    renderDrive();

    await waitFor(() => {
      expect(fetchDriveRecentsPageMock).toHaveBeenCalled();
    });

    fetchDriveRecentsPageMock.mockClear();
    const [searchInput] = screen.getAllByPlaceholderText("searchPlaceholder");
    await user.type(searchInput, "report");

    await waitFor(() => {
      expect(fetchDriveRecentsPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: "report" }),
      );
    });
  });

  it("opens browse for legacy folder links without view=browse", async () => {
    searchParams = new URLSearchParams("folder=Reports");
    listDriveItemsMock.mockResolvedValue([reportsFolder()]);

    renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    expect(fetchDriveRecentsPageMock).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "workspaceTab" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switches to browse when the browse tab is selected", async () => {
    const user = userEvent.setup();
    listDriveItemsMock.mockResolvedValue([reportsFolder()]);

    renderDrive();

    await waitFor(() => {
      expect(fetchDriveRecentsPageMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("tab", { name: "workspaceTab" }));

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });
  });
});

describe("DrivePage files view mode", () => {
  beforeEach(() => {
    queryClient = createDriveQueryClient();
    searchParams = new URLSearchParams();
    replaceMock.mockReset();
    pushMock.mockReset();
    useSessionMock.mockReset();
    listDriveItemsMock.mockReset();
    fetchDriveTasksPageMock.mockReset();
    fetchDriveRecentsPageMock.mockReset();
    getUsersByIdOrganizationsMock.mockReset();
    useIsMobileMock.mockReset();
    useIsMobileMock.mockReturnValue(false);
    document.cookie = "files_view_mode=; path=/; max-age=0";

    fetchDriveTasksPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    fetchDriveRecentsPageMock.mockResolvedValue({
      items: [
        {
          kind: "drive-file",
          name: "notes.txt",
          fileUrl: "https://example.com/notes.txt",
          pathname: "notes.txt",
          size: 12,
          activityAt: "2026-08-28T10:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    listDriveItemsMock.mockResolvedValue([
      {
        type: "file" as const,
        name: "report.pdf",
        pathname: "report.pdf",
        fileUrl: "https://example.com/report.pdf",
        size: 100,
        uploadedAt: "2026-08-28T09:00:00.000Z",
      },
    ]);
    getUsersByIdOrganizationsMock.mockResolvedValue({
      data: {
        data: [{ id: "org_a", name: "Org A" }],
      },
    });
    useSessionMock.mockReturnValue(sessionFor("org_a"));
  });

  it("defaults to list layout on Recents and Browse", async () => {
    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("files-layout-list")).toBeVisible();
    });
    expect(screen.getByRole("radio", { name: "viewList" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByTestId("files-layout-grid")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "workspaceTab" }));

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });
    expect(screen.getByTestId("files-layout-list")).toBeVisible();
    expect(screen.queryByTestId("files-layout-grid")).not.toBeInTheDocument();
  });

  it("switches Recents and Browse to grid without refetching", async () => {
    const user = userEvent.setup();
    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("files-layout-list")).toBeVisible();
    });

    const recentsCalls = fetchDriveRecentsPageMock.mock.calls.length;
    await user.click(screen.getByRole("radio", { name: "viewGrid" }));

    expect(screen.getByTestId("files-layout-grid")).toBeVisible();
    expect(screen.queryByTestId("files-layout-list")).not.toBeInTheDocument();
    expect(fetchDriveRecentsPageMock.mock.calls.length).toBe(recentsCalls);

    await user.click(screen.getByRole("tab", { name: "workspaceTab" }));

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });
    const browseCallsBeforeToggle = listDriveItemsMock.mock.calls.length;
    expect(screen.getByTestId("files-layout-grid")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "viewList" }));
    expect(screen.getByTestId("files-layout-list")).toBeVisible();
    expect(listDriveItemsMock.mock.calls.length).toBe(browseCallsBeforeToggle);

    await user.click(screen.getByRole("radio", { name: "viewGrid" }));
    expect(screen.getByTestId("files-layout-grid")).toBeVisible();
    expect(listDriveItemsMock.mock.calls.length).toBe(browseCallsBeforeToggle);
  });

  it("restores the grid preference after remount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("files-layout-list")).toBeVisible();
    });

    await user.click(screen.getByRole("radio", { name: "viewGrid" }));
    expect(screen.getByTestId("files-layout-grid")).toBeVisible();

    unmount();
    queryClient = createDriveQueryClient();
    const remountMode =
      parseFilesViewModeCookieHeader(document.cookie) ?? "list";
    renderDrive(remountMode);

    await waitFor(() => {
      expect(screen.getByTestId("files-layout-grid")).toBeVisible();
    });
    expect(screen.getByRole("radio", { name: "viewGrid" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows a grid skeleton while Recents is loading when grid is saved", async () => {
    document.cookie = "files_view_mode=grid; path=/";
    let resolveRecents!: (value: {
      items: unknown[];
      nextCursor: string | null;
    }) => void;
    fetchDriveRecentsPageMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRecents = resolve;
        }),
    );

    renderDrive(resolveFilesViewModeFromClientCookie(document.cookie));

    await waitFor(() => {
      expect(screen.getByTestId("files-layout-skeleton-grid")).toBeVisible();
    });
    expect(
      screen.queryByTestId("files-layout-skeleton-list"),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveRecents({
        items: [
          {
            kind: "drive-file",
            name: "notes.txt",
            fileUrl: "https://example.com/notes.txt",
            pathname: "notes.txt",
            size: 12,
            activityAt: "2026-08-28T10:00:00.000Z",
          },
        ],
        nextCursor: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("files-layout-grid")).toBeVisible();
    });
  });

  it("shows the layout switch on the Tasks special folder and respects grid", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("view=tasks");
    fetchDriveTasksPageMock.mockResolvedValue({
      items: [
        {
          type: "project" as const,
          id: "proj_1",
          name: "Alpha",
          latestFileUpdatedAt: "2026-08-28T10:00:00.000Z",
        },
      ],
      nextCursor: null,
    });

    renderDrive();

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeVisible();
    });
    expect(screen.getByTestId("files-view-mode-switch")).toBeVisible();
    expect(screen.getByTestId("files-layout-list")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "viewGrid" }));

    expect(screen.getByTestId("files-layout-grid")).toBeVisible();
    expect(screen.queryByTestId("files-layout-list")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeVisible();
  });

  it("hides the view switch and forces list on mobile even when grid is saved", async () => {
    useIsMobileMock.mockReturnValue(true);
    document.cookie = "files_view_mode=grid; path=/";

    renderDrive(resolveFilesViewModeFromClientCookie(document.cookie));

    await waitFor(() => {
      expect(screen.getByTestId("files-layout-list")).toBeVisible();
    });
    expect(screen.queryByTestId("files-layout-grid")).not.toBeInTheDocument();

    const viewSwitch = screen.getByTestId("files-view-mode-switch");
    expect(viewSwitch.className).toContain("hidden");
    expect(viewSwitch.className).toContain("@2xl:flex");
  });

  it("hides task/project path under the filename in grid", async () => {
    const user = userEvent.setup();
    fetchDriveRecentsPageMock.mockResolvedValue({
      items: [
        {
          kind: "task-output",
          name: "result.png",
          fileUrl: "https://example.com/result.png",
          size: 42,
          activityAt: "2026-08-28T10:00:00.000Z",
          taskFileId: "tf_1",
          taskId: "task_1",
          taskName: "Launch prep",
          projectId: "proj_1",
          projectName: "Alpha",
        },
      ],
      nextCursor: null,
    });

    renderDrive();

    await waitFor(() => {
      expect(screen.getByText("result.png")).toBeVisible();
    });
    expect(screen.getByText("Launch prep · Alpha")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "viewGrid" }));

    expect(screen.getByTestId("files-layout-grid")).toBeVisible();
    expect(screen.getByText("result.png")).toBeVisible();
    expect(screen.queryByText("Launch prep · Alpha")).not.toBeInTheDocument();
  });

  it("navigates into a folder when the card is clicked", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("view=browse");
    listDriveItemsMock.mockResolvedValue([
      {
        type: "folder" as const,
        name: "Reports",
        path: "Reports",
      },
    ]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    });

    expect(screen.queryByText("folder")).not.toBeInTheDocument();

    pushMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Reports" }));

    expect(pushMock).toHaveBeenCalled();
    expect(String(pushMock.mock.calls[0]?.[0])).toContain("folder=");
  });

  it("opens a file preview when the card is clicked", async () => {
    const user = userEvent.setup();
    // Inside a folder: that is where the listing carries files. At the
    // Workspace root the listing carries folders and the catalog carries the
    // files, so a root file row no longer exists to click.
    searchParams = new URLSearchParams("view=workspace&folder=Reports");
    listDriveItemsMock.mockResolvedValue([
      {
        type: "file" as const,
        name: "photo.png",
        pathname: "photo.png",
        fileUrl: "https://example.com/photo.png",
        size: 100,
        uploadedAt: "2026-08-28T09:00:00.000Z",
      },
    ]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "photo.png" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "photo.png" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "photo.png" })).toBeVisible();
    });
  });

  it("does not activate the card when the overflow menu is clicked", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("view=browse");
    listDriveItemsMock.mockResolvedValue([
      {
        type: "folder" as const,
        name: "Reports",
        path: "Reports",
      },
    ]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    });

    pushMock.mockClear();
    await user.click(screen.getByTestId("drive-item-more-actions"));

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("browse mobile actions menu exposes sort and create folder", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("view=browse");
    listDriveItemsMock.mockResolvedValue([]);

    renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    expect(screen.getByTestId("files-mobile-actions")).toBeVisible();
    // Desktop create-folder control remains in the header for wide containers.
    expect(
      screen.getAllByRole("button", { name: "createFolder" }).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByTestId("files-mobile-actions"));
    expect(screen.getByTestId("files-mobile-sort-name")).toBeVisible();
    expect(screen.getByTestId("files-mobile-create-folder")).toHaveTextContent(
      "createFolder",
    );

    await user.click(screen.getByTestId("files-mobile-create-folder"));
    expect(
      screen.getByRole("dialog", { name: "createFolderDialogTitle" }),
    ).toBeVisible();
  });

  it("puts desktop tabs and folder actions on one header row", async () => {
    // Inside a folder, because the page's search field is the folder
    // listing's. At the root the catalog owns search and this header has none.
    searchParams = new URLSearchParams("view=workspace&folder=Reports");
    listDriveItemsMock.mockResolvedValue([]);

    renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    const header = screen.getByTestId("files-desktop-header");
    expect(header.className).toContain("flex-col");
    expect(header.className).toContain("@xl:flex-row");
    expect(
      within(header).getByRole("tab", { name: "recentsTab" }),
    ).toBeVisible();
    expect(
      within(header).getByRole("button", { name: "createFolder" }),
    ).toBeVisible();
    expect(
      within(header).getByPlaceholderText("searchPlaceholder"),
    ).toBeVisible();
  });

  it("keeps mobile create-folder path outside the desktop header row", async () => {
    useIsMobileMock.mockReturnValue(true);
    searchParams = new URLSearchParams("view=browse");
    listDriveItemsMock.mockResolvedValue([]);

    renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    const header = screen.getByTestId("files-desktop-header");
    expect(screen.getByTestId("files-mobile-actions")).toBeVisible();
    expect(
      within(header).queryByTestId("files-mobile-actions"),
    ).not.toBeInTheDocument();
  });
});

describe("DrivePage files sort", () => {
  const onUrlUpdate = vi.fn();

  function renderDriveWithUrlSpy(defaultFilesViewMode: FilesViewMode = "list") {
    return render(
      <NuqsTestingAdapter
        searchParams={searchParams}
        hasMemory
        onUrlUpdate={onUrlUpdate}
      >
        <QueryClientProvider client={queryClient}>
          <DrivePageClient defaultFilesViewMode={defaultFilesViewMode} />
        </QueryClientProvider>
      </NuqsTestingAdapter>,
    );
  }

  beforeEach(() => {
    queryClient = createDriveQueryClient();
    searchParams = new URLSearchParams("view=browse");
    onUrlUpdate.mockReset();
    replaceMock.mockReset();
    pushMock.mockReset();
    useSessionMock.mockReset();
    listDriveItemsMock.mockReset();
    fetchDriveTasksPageMock.mockReset();
    fetchDriveRecentsPageMock.mockReset();
    getUsersByIdOrganizationsMock.mockReset();
    useIsMobileMock.mockReset();
    useIsMobileMock.mockReturnValue(false);

    fetchDriveTasksPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    fetchDriveRecentsPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    listDriveItemsMock.mockResolvedValue([reportsFolder()]);
    getUsersByIdOrganizationsMock.mockResolvedValue({
      data: {
        data: [{ id: "org_a", name: "Org A" }],
      },
    });
    useSessionMock.mockReturnValue(sessionFor("org_a"));
  });

  it("replaces rather than pushes when the archived filter changes", async () => {
    searchParams = new URLSearchParams("view=tables");
    const user = userEvent.setup();
    renderDriveWithUrlSpy();

    await waitFor(() => {
      expect(listDataTablesMock).toHaveBeenCalled();
    });

    await user.click(screen.getByTestId("tables-archived-filter"));

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalled();
    });
    const lastUpdate = onUrlUpdate.mock.calls.at(-1)?.[0] as {
      searchParams: URLSearchParams;
      options: { history?: string };
    };
    expect(lastUpdate.searchParams.get("archived")).toBe("true");
    // A filter is not a navigation step. The sort control beside it and the
    // tasks filter this one copies both replace, and the toggle it replaced
    // added no history at all — pushing makes Back undo the filter instead of
    // leaving the page.
    expect(lastUpdate.options.history).toBe("replace");
  });

  it("Browse omit default shows Name; Date stays explicit in URL and fetch", async () => {
    const user = userEvent.setup();
    renderDriveWithUrlSpy();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    const browseCall = listDriveItemsMock.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(browseCall).not.toHaveProperty("sortBy");
    expect(browseCall).not.toHaveProperty("sortOrder");
    expect(screen.getByTestId("files-sort-trigger")).toHaveTextContent(
      /sortByName|Name/i,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-date"));

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalled();
    });
    const lastUpdate = onUrlUpdate.mock.calls.at(-1)?.[0] as {
      searchParams: URLSearchParams;
    };
    expect(lastUpdate.searchParams.get("sortBy")).toBe("date");
    expect(lastUpdate.searchParams.get("sortOrder")).toBe("desc");
    expect(lastUpdate.searchParams.get("view")).toBe("browse");

    await waitFor(() => {
      const options = listDriveItemsMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      expect(options.sortBy).toBe("date");
      expect(options.sortOrder).toBe("desc");
    });

    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-name"));

    await waitFor(() => {
      const update = onUrlUpdate.mock.calls.at(-1)?.[0] as {
        searchParams: URLSearchParams;
      };
      expect(update.searchParams.get("sortBy")).toBeNull();
      expect(update.searchParams.get("sortOrder")).toBeNull();
    });
  });

  it("keeps view and folder params when sort is applied", async () => {
    searchParams = new URLSearchParams("view=browse&folder=Reports");
    const user = userEvent.setup();
    renderDriveWithUrlSpy();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-type"));

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalled();
    });
    const lastUpdate = onUrlUpdate.mock.calls.at(-1)?.[0] as {
      searchParams: URLSearchParams;
    };
    expect(lastUpdate.searchParams.get("view")).toBe("browse");
    expect(lastUpdate.searchParams.get("folder")).toBe("Reports");
    expect(lastUpdate.searchParams.get("sortBy")).toBe("type");
    expect(lastUpdate.searchParams.get("sortOrder")).toBe("asc");
  });

  it("recents omits sort params even when URL has sort", async () => {
    searchParams = new URLSearchParams("sortBy=name&sortOrder=asc");
    renderDrive();

    await waitFor(() => {
      expect(fetchDriveRecentsPageMock).toHaveBeenCalled();
    });

    expect(listDriveItemsMock).not.toHaveBeenCalled();
    const recentsCall = fetchDriveRecentsPageMock.mock.calls.at(
      -1,
    )?.[0] as Record<string, unknown>;
    expect(recentsCall).not.toHaveProperty("sortBy");
    expect(recentsCall).not.toHaveProperty("sortOrder");
    expect(screen.queryByTestId("files-sort-trigger")).not.toBeInTheDocument();
  });

  it("omitted default does not send a sort override on browse", async () => {
    searchParams = new URLSearchParams();
    renderDrive();

    await waitFor(() => {
      expect(fetchDriveRecentsPageMock).toHaveBeenCalled();
    });
    const recentsCall = fetchDriveRecentsPageMock.mock.calls.at(
      -1,
    )?.[0] as Record<string, unknown>;
    expect(recentsCall).not.toHaveProperty("sortBy");
    expect(recentsCall).not.toHaveProperty("sortOrder");

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "workspaceTab" }));

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });
    const browseCall = listDriveItemsMock.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(browseCall).not.toHaveProperty("sortBy");
    expect(browseCall).not.toHaveProperty("sortOrder");
    expect(screen.getByTestId("files-sort-trigger")).toBeVisible();
  });
});

describe("DrivePage workspace tab and breadcrumb root", () => {
  beforeEach(() => {
    queryClient = createDriveQueryClient();
    searchParams = new URLSearchParams("view=browse");
    replaceMock.mockReset();
    pushMock.mockReset();
    useSessionMock.mockReset();
    listDriveItemsMock.mockReset();
    listDataTablesMock.mockReset();
    fetchDriveTasksPageMock.mockReset();
    fetchDriveRecentsPageMock.mockReset();
    getUsersByIdOrganizationsMock.mockReset();
    useIsMobileMock.mockReset();
    useIsMobileMock.mockReturnValue(false);

    fetchDriveTasksPageMock.mockResolvedValue({ items: [], nextCursor: null });
    fetchDriveRecentsPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    listDriveItemsMock.mockResolvedValue([reportsFolder()]);
    listDataTablesMock.mockResolvedValue({ items: [], nextCursor: null });
    getUsersByIdOrganizationsMock.mockResolvedValue({
      data: { data: [{ id: "org_a", name: "Org A" }] },
    });
    useSessionMock.mockReturnValue(sessionFor("org_a"));
  });

  it("names the second tab for the view, not for the organization", async () => {
    renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    expect(screen.getByRole("tab", { name: "workspaceTab" })).toBeVisible();
    // The organization name used to be the tab's label, so it must no longer
    // name any tab on this page.
    expect(screen.queryByRole("tab", { name: "Org A" })).toBeNull();
  });

  it("drops the breadcrumb root chip at the workspace root", async () => {
    renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    // The chip carried the organization name and an aria-label of its own.
    expect(
      screen.queryByRole("navigation", { name: "breadcrumbNavLabel" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Org A" })).toBeNull();
  });

  it("keeps a keyboard-reachable root control inside a folder", async () => {
    searchParams = new URLSearchParams("view=browse&folder=Reports");
    renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    const nav = screen.getByRole("navigation", {
      name: "breadcrumbNavLabel",
    });
    const root = within(nav).getByRole("button", { name: "workspaceTab" });
    expect(root).toBeVisible();

    // It is a real button, so it is a tab stop and Enter/Space activate it.
    expect(root.tagName).toBe("BUTTON");

    await userEvent.setup().click(root);
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("view=workspace"),
    );
    expect(pushMock.mock.calls.at(-1)?.[0]).not.toContain("folder=");
  });

  /**
   * The row is `@xl:items-center`, so from `@xl` up its height is its tallest
   * child's and the 36px tab strip is centred in it: any control still 40px
   * there lifts the row and moves the strip, and the page under it, by 2px on
   * a tab switch. happy-dom computes no layout, so this asserts the rule that
   * produces the height rather than the height.
   *
   * It is deliberately a sweep over every control in the row, not a check of
   * one known control: the previous version asserted `md:h-8` on the search
   * box alone and passed while the jump was still live at 624px, 700px and
   * 760px, because `md:` is a viewport query and this row's layout is driven
   * by container queries.
   */
  function headerRowControls(): HTMLElement[] {
    const header = screen.getByTestId("files-desktop-header");
    return [
      ...header.querySelectorAll<HTMLElement>(
        'button, input:not([type="file"]), [role="tablist"]',
      ),
    ];
  }

  function assertHeaderRowHeightContract(controls: HTMLElement[]) {
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const classes = control.className;
      if (classes.includes("h-10")) {
        // A 40px control is fine while the row is stacked, but it has to step
        // down on the row's own container query.
        expect(
          classes,
          `${control.tagName} "${(control.textContent || "").trim().slice(0, 24)}" is h-10 without the @xl step-down`,
        ).toContain("@xl:h-8");
      }
      // A viewport step in this row is the F1 defect: it disagrees with the
      // container queries that decide when the row becomes a centred row.
      expect(
        classes,
        `${control.tagName} "${(control.textContent || "").trim().slice(0, 24)}" steps on a viewport query in a container-query row`,
      ).not.toContain("md:h-8");
    }
  }

  it("keeps every Recents header-row control at the tab strip's height", async () => {
    searchParams = new URLSearchParams();
    renderDrive();
    await waitFor(() => {
      expect(fetchDriveRecentsPageMock).toHaveBeenCalled();
    });

    const controls = headerRowControls();
    assertHeaderRowHeightContract(controls);
    // The search box is the one control here that is not `size="sm"`.
    const search = within(
      screen.getByTestId("files-desktop-header"),
    ).getByPlaceholderText("searchPlaceholder");
    expect(search.className).toContain("@xl:h-8");
  });

  it("keeps every Workspace header-row control at the tab strip's height", async () => {
    searchParams = new URLSearchParams("view=browse");
    renderDrive();
    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    assertHeaderRowHeightContract(headerRowControls());
  });

  it("keeps every Tables header-row control at the tab strip's height", async () => {
    searchParams = new URLSearchParams("view=tables");
    renderDrive();
    await waitFor(() => {
      expect(listDataTablesMock).toHaveBeenCalled();
    });

    const controls = headerRowControls();
    assertHeaderRowHeightContract(controls);
    // `New table` renders at every width — unlike every other tab's controls,
    // which are `hidden @2xl:*` — so it is the control that would keep the
    // Tables row taller than the others between @xl and @2xl.
    const createTable = controls.find((c) =>
      (c.textContent || "").includes("newTable"),
    );
    expect(createTable).toBeDefined();
    expect(createTable?.className).toContain("@xl:h-8");
  });

  it("keeps the tasks-view breadcrumb root crumb at every depth", async () => {
    searchParams = new URLSearchParams("view=tasks");
    renderDrive();

    await waitFor(() => {
      expect(fetchDriveTasksPageMock).toHaveBeenCalled();
    });

    // The tasks view shares the workspace tab, so its tab is already selected
    // and cannot navigate: unlike the browse trail, this nav must render its
    // root crumb even at the root or the file root becomes unreachable here.
    const nav = screen.getByRole("navigation", { name: "breadcrumbNavLabel" });
    const root = within(nav).getByRole("button", { name: "workspaceTab" });
    expect(root).toBeVisible();
    expect(root.tagName).toBe("BUTTON");
    // The organization chip this replaced carried an icon and the org name.
    expect(root.querySelector("svg")).toBeNull();
    expect(within(nav).queryByRole("button", { name: "Org A" })).toBeNull();

    await userEvent.setup().click(root);
    expect(pushMock.mock.calls.at(-1)?.[0]).toContain("view=workspace");
  });

  it("drops the tables-only archived param when navigating away", async () => {
    searchParams = new URLSearchParams(
      "view=browse&folder=Reports&archived=true",
    );
    renderDrive();

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    // These paths rebuild the query from the current URL. Only the tables list
    // reads `archived`, so left in it rides into browse and tasks and ends up
    // in shared links.
    const nav = screen.getByRole("navigation", { name: "breadcrumbNavLabel" });
    await userEvent
      .setup()
      .click(within(nav).getByRole("button", { name: "workspaceTab" }));

    const pushed = pushMock.mock.calls.at(-1)?.[0] as string;
    expect(pushed).toContain("view=workspace");
    expect(pushed).not.toContain("archived");
  });

  it("puts the archived filter in the page filter row and drives the list", async () => {
    searchParams = new URLSearchParams("view=tables");
    const user = userEvent.setup();
    renderDrive();

    await waitFor(() => {
      expect(listDataTablesMock).toHaveBeenCalled();
    });

    // In the page header row that holds the tabs and the other filters, not
    // inside the list panel.
    const header = screen.getByTestId("files-desktop-header");
    const filter = within(header).getByTestId("tables-archived-filter");
    expect(filter).toHaveAttribute("data-archived", "false");
    expect(listDataTablesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: "false" }),
    );

    await user.click(filter);

    await waitFor(() => {
      expect(listDataTablesMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ archived: "true" }),
      );
    });
    expect(
      within(screen.getByTestId("files-desktop-header")).getByTestId(
        "tables-archived-filter",
      ),
    ).toHaveAttribute("data-archived", "true");
  });
});

describe("one catalog, not two", () => {
  beforeEach(() => {
    queryClient = createDriveQueryClient();
    searchParams = new URLSearchParams("view=workspace");
    replaceMock.mockReset();
    pushMock.mockReset();
    useSessionMock.mockReset();
    listDriveItemsMock.mockReset();
    getUsersByIdOrganizationsMock.mockReset();
    fetchDriveTasksPageMock.mockReset();
    fetchDriveRecentsPageMock.mockReset();
    listDataTablesMock.mockReset();
    useIsMobileMock.mockReset();
    useIsMobileMock.mockReturnValue(false);

    fetchDriveTasksPageMock.mockResolvedValue({ items: [], nextCursor: null });
    fetchDriveRecentsPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    listDataTablesMock.mockResolvedValue([]);
    getUsersByIdOrganizationsMock.mockResolvedValue({
      data: { data: [{ id: "org_a", name: "Org A" }] },
    });
    useSessionMock.mockReturnValue(sessionFor("org_a"));
  });

  it("offers three tabs, and no All files tab", async () => {
    listDriveItemsMock.mockResolvedValue([]);
    renderDrive();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "recentsTab" })).toBeVisible();
    });

    // Two tabs listing the same files was the defect. Workspace is the
    // catalog now, so there is nothing for a fourth tab to hold.
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "workspaceTab" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "tablesTab" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "allFilesTab" })).toBeNull();
  });

  it("renders the catalog at the Workspace root, with the Workspace tab selected", async () => {
    listDriveItemsMock.mockResolvedValue([]);
    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "workspaceTab" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps folders on the Workspace root so they can still be navigated", async () => {
    // The catalog lists files and has no folder rows, so without these the
    // merge would have removed the only way into a folder — and with it
    // folder create, rename, move and delete, which live in this listing.
    listDriveItemsMock.mockResolvedValue([
      reportsFolder(),
      {
        type: "file" as const,
        name: "root-file.png",
        pathname: "root-file.png",
        fileUrl: "https://example.com/root-file.png",
        size: 10,
        uploadedAt: "2026-08-28T09:00:00.000Z",
      },
    ]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    });
    expect(
      screen.getByRole("button", { name: /renameAction/i }),
    ).toBeInTheDocument();

    // And the root file is NOT duplicated into the folder listing: the
    // catalog below is the one place every file is listed.
    expect(screen.queryByRole("button", { name: "root-file.png" })).toBeNull();
  });

  it("narrows to the folder listing inside a folder, and drops the catalog", async () => {
    searchParams = new URLSearchParams("view=workspace&folder=Reports");
    listDriveItemsMock.mockResolvedValue([
      {
        type: "file" as const,
        name: "inside.png",
        pathname: "Reports/inside.png",
        fileUrl: "https://example.com/inside.png",
        size: 10,
        uploadedAt: "2026-08-28T09:00:00.000Z",
      },
    ]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "inside.png" })).toBeVisible();
    });
    // A folder is a scope on the same tab, not a second list beside it.
    expect(screen.queryByTestId("drive-all-files")).toBeNull();
    expect(
      screen.getByRole("navigation", { name: "breadcrumbNavLabel" }),
    ).toBeVisible();
  });

  it("opens the Workspace tab for a legacy view=all link, carrying its query", async () => {
    // Global search's "See all files" and the file detail page's back link
    // both shipped pointing at view=all.
    searchParams = new URLSearchParams("view=all&q=invoice");
    listDriveItemsMock.mockResolvedValue([]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "workspaceTab" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("drive-all-files")).toHaveAttribute(
      "data-initial-query",
      "invoice",
    );
  });

  it("opens the Workspace tab for a legacy view=browse link", async () => {
    searchParams = new URLSearchParams("view=browse");
    listDriveItemsMock.mockResolvedValue([]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "workspaceTab" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows one search field at the root, and it belongs to the catalog", async () => {
    listDriveItemsMock.mockResolvedValue([]);
    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    // The page's own field would be a second search box over one list, which
    // is the duplication the tab merge removed one level down.
    expect(screen.queryByPlaceholderText("searchPlaceholder")).toBeNull();
    // Folder management stays reachable at the root. Scoped to the header,
    // because the mobile actions menu carries its own copy and the stubbed
    // dropdown renders its content at every width.
    const header = screen.getByTestId("files-desktop-header");
    expect(
      within(header).getByRole("button", { name: "createFolder" }),
    ).toBeVisible();
    expect(
      within(header).queryByPlaceholderText("searchPlaceholder"),
    ).toBeNull();
  });
});
