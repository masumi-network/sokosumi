import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useSessionMock = vi.fn();
const listDriveItemsMock = vi.fn();
const patchDriveFoldersRenameMock = vi.fn();
const postDriveFoldersMock = vi.fn();
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
  postDriveFolders: (...args: unknown[]) => postDriveFoldersMock(...args),
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
  DriveAllFilesPanel: ({
    initialQuery,
    initialFolder,
    onFolderChange,
  }: {
    initialQuery?: string;
    initialFolder?: string;
    onFolderChange?: (folder: string) => void;
  }) => (
    <div
      data-testid="drive-all-files"
      data-initial-query={initialQuery ?? ""}
      data-initial-folder={initialFolder ?? ""}
    >
      {/* The seam the real panel uses to tell the page head which folder is
          narrowing the list, so the folder actions there act on it. */}
      <button
        type="button"
        data-testid="drive-all-files-apply-folder"
        onClick={() => onFolderChange?.("Reports")}
      >
        facet
      </button>
    </div>
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

  it("stops offering folder actions on another workspace's folder", async () => {
    /**
     * The folder actions in the page head act on whichever folder is narrowing
     * the catalog. A workspace switch is a different corpus, so that folder is
     * not one of its folders — offering Delete on it would delete nothing, or
     * something else.
     */
    searchParams = new URLSearchParams("view=workspace&folder=Reports");
    useSessionMock.mockReturnValue(sessionFor("org_a"));

    const { rerender } = renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("files-delete-folder")).toBeInTheDocument();
    });

    useSessionMock.mockReturnValue(sessionFor("org_b"));
    rerender(driveTree());

    await waitFor(() => {
      expect(screen.queryByTestId("files-delete-folder")).toBeNull();
    });
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
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
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

    // With a folder applied, so the page head offers the folder actions the
    // folder cards used to carry.
    searchParams = new URLSearchParams("view=workspace&folder=Reports");
    useSessionMock.mockReturnValue(sessionFor("org_a"));
    const { rerender } = renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("files-move-folder")).toBeInTheDocument();
    });
    // The head acts on the folder the deep link applied.
    expect(screen.getByTestId("drive-all-files")).toHaveAttribute(
      "data-initial-folder",
      "Reports",
    );

    await user.click(screen.getByTestId("files-move-folder"));
    expect(screen.getByText("loadingFolders")).toBeVisible();

    useSessionMock.mockReturnValue(sessionFor("org_b"));
    rerender(driveTree());

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });

    /**
     * The facet was cleared by the workspace switch, so the page head has no
     * folder to act on. Applying one again through the catalog's own seam is
     * how the reader gets back there, and the dialog it opens is the one the
     * staleness is measured against.
     */
    await user.click(screen.getByTestId("drive-all-files-apply-folder"));
    await waitFor(() => {
      expect(screen.getByTestId("files-move-folder")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("files-move-folder"));

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

  it("defaults to list layout on Recents, and hands the catalog the same mode", async () => {
    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("files-layout-list")).toBeVisible();
    });
    expect(screen.getByRole("radio", { name: "viewList" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByTestId("files-layout-grid")).not.toBeInTheDocument();

    // The Workspace tab has no list of its own to lay out: it is the catalog,
    // which lays out its own rows from the mode this switch sets.
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "workspaceTab" }));

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("files-layout-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("files-layout-grid")).not.toBeInTheDocument();
  });

  it("switches Recents to grid without refetching", async () => {
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

  it("renders no folder cards on the Workspace tab", async () => {
    /**
     * The grid is what the catalog replaced. It listed folders above the
     * catalog's own list, so a reader met browse-by-folder and
     * search-the-catalog stacked on one screen and picked neither.
     *
     * A folder is a facet inside the catalog now: `?folder=` pre-applies one,
     * and the filter sheet changes it.
     */
    searchParams = new URLSearchParams("view=workspace");
    listDriveItemsMock.mockResolvedValue([
      { type: "folder" as const, name: "Reports", path: "Reports" },
    ]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Reports" })).toBeNull();
    expect(screen.queryByTestId("drive-item-more-actions")).toBeNull();
  });

  it("carries a folder deep link into the catalog as a facet", async () => {
    searchParams = new URLSearchParams("view=workspace&folder=Reports");
    listDriveItemsMock.mockResolvedValue([]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    // Links to `?folder=` shipped, and they still land on the same files —
    // narrowed inside one list rather than switching into another.
    expect(screen.getByTestId("drive-all-files")).toHaveAttribute(
      "data-initial-folder",
      "Reports",
    );
  });

  it("workspace mobile actions menu exposes create folder and task outputs", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("view=workspace");
    listDriveItemsMock.mockResolvedValue([]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });

    expect(screen.getByTestId("files-mobile-actions")).toBeVisible();
    // Desktop create-folder control remains in the header for wide containers.
    expect(
      screen.getAllByRole("button", { name: "createFolder" }).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByTestId("files-mobile-actions"));
    expect(screen.getByTestId("files-mobile-create-folder")).toHaveTextContent(
      "createFolder",
    );
    // The Tasks view was reachable only through a card in the grid, so without
    // this the grid's removal would have orphaned a whole view.
    expect(screen.getByTestId("files-mobile-tasks-outputs")).toBeVisible();

    await user.click(screen.getByTestId("files-mobile-create-folder"));
    expect(
      screen.getByRole("dialog", { name: "createFolderDialogTitle" }),
    ).toBeVisible();
  });

  it("puts desktop tabs and folder actions on one header row", async () => {
    searchParams = new URLSearchParams("view=workspace");
    listDriveItemsMock.mockResolvedValue([]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
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
    // And no search field: the catalog's own is the first thing on the page.
    expect(
      within(header).queryByPlaceholderText("searchPlaceholder"),
    ).toBeNull();
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

  it("Tasks omit default shows Date; an explicit choice stays in URL and fetch", async () => {
    const user = userEvent.setup();
    /**
     * The Tasks view, because that is the only list left that this control
     * orders. The Workspace tab is the catalog, ordered by relevance or
     * recency, and a sort control that does not reorder the list under it is
     * the kind of thing this tab was merged to remove.
     */
    searchParams = new URLSearchParams("view=tasks");
    renderDriveWithUrlSpy();

    await waitFor(() => {
      expect(fetchDriveTasksPageMock).toHaveBeenCalled();
    });

    const tasksCall = fetchDriveTasksPageMock.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(tasksCall.sortBy).toBeUndefined();
    expect(tasksCall.sortOrder).toBeUndefined();
    // The tasks surface's own default, which is recency.
    expect(screen.getByTestId("files-sort-trigger")).toHaveTextContent(
      /sortByDate|Date/i,
    );

    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-name"));

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalled();
    });
    const lastUpdate = onUrlUpdate.mock.calls.at(-1)?.[0] as {
      searchParams: URLSearchParams;
    };
    expect(lastUpdate.searchParams.get("sortBy")).toBe("name");
    expect(lastUpdate.searchParams.get("sortOrder")).toBe("asc");
    expect(lastUpdate.searchParams.get("view")).toBe("tasks");

    await waitFor(() => {
      const options = fetchDriveTasksPageMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      expect(options.sortBy).toBe("name");
      expect(options.sortOrder).toBe("asc");
    });

    // And back to the surface's default, which is carried by absence.
    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-date"));

    await waitFor(() => {
      const update = onUrlUpdate.mock.calls.at(-1)?.[0] as {
        searchParams: URLSearchParams;
      };
      expect(update.searchParams.get("sortBy")).toBeNull();
      expect(update.searchParams.get("sortOrder")).toBeNull();
    });
  });

  it("keeps the view and project params when sort is applied", async () => {
    searchParams = new URLSearchParams("view=tasks&projectId=p-1");
    const user = userEvent.setup();
    renderDriveWithUrlSpy();

    await waitFor(() => {
      expect(fetchDriveTasksPageMock).toHaveBeenCalled();
    });

    await user.click(screen.getByTestId("files-sort-trigger"));
    await user.click(screen.getByTestId("files-sort-type"));

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalled();
    });
    const lastUpdate = onUrlUpdate.mock.calls.at(-1)?.[0] as {
      searchParams: URLSearchParams;
    };
    expect(lastUpdate.searchParams.get("view")).toBe("tasks");
    expect(lastUpdate.searchParams.get("projectId")).toBe("p-1");
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

  it("omitted default does not send a sort override on the catalog", async () => {
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
    // The tab is the catalog, which this control would not order. Its presence
    // on the Tasks view is covered by the two cases above.
    expect(screen.queryByTestId("files-sort-trigger")).toBeNull();
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

  it("draws no folder trail, because there is nowhere to walk to", async () => {
    /**
     * A folder is a facet inside the catalog, not a place the reader navigates
     * into, so there is no path to walk back up. The applied folder shows as a
     * removable chip inside the catalog instead — one representation of one
     * thing, rather than a trail in the head and a chip in the list.
     */
    searchParams = new URLSearchParams("view=workspace&folder=Reports");
    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("navigation", { name: "breadcrumbNavLabel" }),
    ).toBeNull();
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
    // The tasks trail's root crumb, which is the one control left that rebuilds
    // the query from the current URL. Only the tables list reads `archived`, so
    // left in it rides into the catalog and into shared links.
    searchParams = new URLSearchParams("view=tasks&archived=true");
    renderDrive();

    await waitFor(() => {
      expect(fetchDriveTasksPageMock).toHaveBeenCalled();
    });

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

  it("keeps folder management, in the one place left that can hold it", async () => {
    /**
     * Rename, move and delete lived on the folder cards and nowhere else in the
     * product, so deleting the grid would have deleted folder management with
     * it. They are in the page head's actions menu now, acting on the folder
     * that is narrowing the catalog.
     */
    searchParams = new URLSearchParams("view=workspace&folder=Reports");
    listDriveItemsMock.mockResolvedValue([]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    expect(screen.getByTestId("files-rename-folder")).toBeInTheDocument();
    expect(screen.getByTestId("files-move-folder")).toBeInTheDocument();
    expect(screen.getByTestId("files-delete-folder")).toBeInTheDocument();
    // And the Tasks view, which was reachable only through a card in the grid.
    expect(screen.getByTestId("files-tasks-outputs")).toBeInTheDocument();
  });

  it("lands in a folder it just created, so the folder is not lost", async () => {
    /**
     * The facet list names folders that hold a file. A folder created a second
     * ago holds nothing, so without this it could not be selected, uploaded
     * into, renamed or deleted: created and then invisible forever. Found by
     * driving a preview.
     */
    const user = userEvent.setup();
    searchParams = new URLSearchParams("view=workspace");
    listDriveItemsMock.mockResolvedValue([]);
    postDriveFoldersMock.mockResolvedValue({ response: { ok: true } });

    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });

    const header = screen.getByTestId("files-desktop-header");
    await user.click(
      within(header).getByRole("button", { name: "createFolder" }),
    );
    await user.type(screen.getByPlaceholderText("folderName"), "Reports");
    await user.click(
      screen.getByRole("button", { name: "createFolderDialogConfirm" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("files-delete-folder")).toBeInTheDocument();
    });
  });

  it("offers no folder actions when no folder is applied", async () => {
    // There is nothing to rename then, and offering it would have to guess.
    searchParams = new URLSearchParams("view=workspace");
    listDriveItemsMock.mockResolvedValue([reportsFolder()]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("files-rename-folder")).toBeNull();
    expect(screen.queryByTestId("files-delete-folder")).toBeNull();
    expect(screen.getByTestId("files-tasks-outputs")).toBeInTheDocument();
  });

  it("keeps the catalog inside a folder, narrowed rather than replaced", async () => {
    searchParams = new URLSearchParams("view=workspace&folder=Reports");
    listDriveItemsMock.mockResolvedValue([]);

    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    // A folder used to swap the catalog out for a folder listing, which is the
    // second navigation model this tab was merged to remove.
    expect(screen.getByTestId("drive-all-files")).toHaveAttribute(
      "data-initial-folder",
      "Reports",
    );
    expect(screen.queryByTestId("files-layout-list")).toBeNull();
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

  it("offers no sort control, because it would not sort what is shown", async () => {
    // Found in a browser, not by a test. The control drove the folder strip;
    // the list a reader looks at is the catalog, ordered by relevance or
    // recency. A sort control that does not reorder the list under it is the
    // same kind of quiet lie the tab merge removed. Its remaining home is the
    // Tasks view, covered in "DrivePage files sort".
    listDriveItemsMock.mockResolvedValue([reportsFolder()]);
    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    const header = screen.getByTestId("files-desktop-header");
    expect(within(header).queryByTestId("files-sort-control")).toBeNull();
  });

  it("shows one search field, and it belongs to the catalog", async () => {
    listDriveItemsMock.mockResolvedValue([]);
    renderDrive();

    await waitFor(() => {
      expect(screen.getByTestId("drive-all-files")).toBeInTheDocument();
    });
    // The page's own field would be a second search box over one list, which
    // is the duplication the tab merge removed one level down.
    expect(screen.queryByPlaceholderText("searchPlaceholder")).toBeNull();
    // New folder stays in the header. Scoped to it, because the mobile actions
    // menu carries its own copy and the stubbed dropdown renders its content at
    // every width.
    const header = screen.getByTestId("files-desktop-header");
    expect(
      within(header).getByRole("button", { name: "createFolder" }),
    ).toBeVisible();
    expect(
      within(header).queryByPlaceholderText("searchPlaceholder"),
    ).toBeNull();
  });
});
