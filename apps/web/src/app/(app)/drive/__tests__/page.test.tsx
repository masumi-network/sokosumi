import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import DrivePage from "@/app/drive/page";

function reportsFolder() {
  return {
    type: "folder" as const,
    name: "Reports",
    path: "Reports",
  };
}

function sessionFor(activeOrganizationId: string) {
  return {
    data: {
      user: { id: "user_1" },
      session: { activeOrganizationId },
    },
  };
}

describe("DrivePage workspace remount", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    replaceMock.mockReset();
    pushMock.mockReset();
    useSessionMock.mockReset();
    listDriveItemsMock.mockReset();
    patchDriveFoldersRenameMock.mockReset();
    getUsersByIdOrganizationsMock.mockReset();

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

    const { rerender } = render(<DrivePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: /renameAction/i }));

    expect(screen.getByDisplayValue("Reports")).toBeVisible();
    expect(screen.getByTitle("saveAction")).toBeVisible();

    useSessionMock.mockReturnValue(sessionFor("org_b"));
    rerender(<DrivePage />);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Reports" }) ??
          screen.queryByDisplayValue("Reports"),
      ).toBeTruthy();
    });

    expect(screen.queryByTitle("saveAction")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    expect(patchDriveFoldersRenameMock).not.toHaveBeenCalled();
  });

  it("drops the folder query when the active organization changes", async () => {
    searchParams = new URLSearchParams("folder=Reports");
    useSessionMock.mockReturnValue(sessionFor("org_a"));

    const { rerender } = render(<DrivePage />);

    await waitFor(() => {
      expect(listDriveItemsMock).toHaveBeenCalled();
    });

    useSessionMock.mockReturnValue(sessionFor("org_b"));
    rerender(<DrivePage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/drive");
    });
  });
});
