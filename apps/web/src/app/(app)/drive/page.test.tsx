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

let searchParams = new URLSearchParams();

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

import DrivePage from "@/app/drive/page";

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

function driveTree() {
  return (
    <NuqsTestingAdapter searchParams={searchParams} hasMemory>
      <QueryClientProvider client={queryClient}>
        <DrivePage />
      </QueryClientProvider>
    </NuqsTestingAdapter>
  );
}

function renderDrive() {
  return render(driveTree());
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
      expect(screen.getByRole("tab", { name: "Org A" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
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
