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
  useIsMobile: (...args: unknown[]) => useIsMobileMock(...args),
  useIsMobileMedia: (...args: unknown[]) => useIsMobileMock(...args),
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
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: ReactNode;
    onSelect?: (event: { preventDefault: () => void }) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect?.({ preventDefault: () => undefined })}
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
  DriveTasksFilters: () => (
    <button type="button" aria-label="filterTitle">
      filterTitle
    </button>
  ),
}));

vi.mock("@/components/ui/image-viewer", () => ({
  ImageViewer: ({ open, alt }: { open: boolean; alt: string }) =>
    open ? <div role="dialog" aria-label={alt} /> : null,
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
    expect(screen.getByRole("tab", { name: "Org A" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("places the tasks filter beside the mobile search input", async () => {
    renderDrive();

    await waitFor(() => {
      expect(fetchDriveTasksPageMock).toHaveBeenCalled();
    });

    const mobileSearchInput = screen
      .getAllByPlaceholderText("tasksSearchPlaceholder")
      .find((input) => input.closest(".md\\:hidden"));

    expect(mobileSearchInput).toBeDefined();

    const mobileToolbar = mobileSearchInput?.closest(".md\\:hidden");
    expect(mobileToolbar).not.toBeNull();
    expect(
      within(mobileToolbar as HTMLElement).getByRole("button", {
        name: "filterTitle",
      }),
    ).toBeVisible();
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
    expect(screen.getByRole("tab", { name: "Org A" })).toHaveAttribute(
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

    await user.click(screen.getByRole("tab", { name: "Org A" }));

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
    await user.click(screen.getByRole("tab", { name: "Org A" }));

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

    await user.click(screen.getByRole("tab", { name: "Org A" }));

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
    expect(viewSwitch.className).toContain("md:flex");
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
    searchParams = new URLSearchParams("view=browse");
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
    await user.click(screen.getByRole("button", { name: "moreActions" }));

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
