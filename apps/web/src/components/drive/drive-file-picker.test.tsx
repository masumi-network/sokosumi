import type {
  DriveFile,
  DriveFileItem,
  DriveItem,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriveFilePicker } from "@/components/drive/drive-file-picker";
import { invalidateDrive } from "@/queries/drive";

const { listDriveItemsMock, getUsersByIdOrganizationsMock, useSessionMock } =
  vi.hoisted(() => ({
    listDriveItemsMock: vi.fn(),
    getUsersByIdOrganizationsMock: vi.fn(),
    useSessionMock: vi.fn(),
  }));

vi.mock("@/lib/utils/drive-file-list.client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/utils/drive-file-list.client")
  >()),
  listDriveItems: (...args: unknown[]) => listDriveItemsMock(...args),
}));

vi.mock("@sokosumi/core-client", () => ({
  getUsersByIdOrganizations: (...args: unknown[]) =>
    getUsersByIdOrganizationsMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({ id: "browser-core-client" }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 0,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "Jan 1",
    number: (value: number) => String(value),
  }),
}));

function makeFile(
  name: string,
  overrides: Partial<DriveFile> = {},
): DriveFileItem {
  return {
    type: "file",
    name,
    fileUrl: `https://blob.example/${name}`,
    pathname: `drive/users/user_1/${name}`,
    size: 1024,
    uploadedAt: new Date("2026-08-18T10:00:00.000Z"),
    dataRoom: false,
    ...overrides,
  };
}

function makeFolder(name: string, dataRoom = false): DriveItem {
  return {
    type: "folder",
    name,
    path: name,
    dataRoom,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
}

describe("DriveFilePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDriveItemsMock.mockReset();
    getUsersByIdOrganizationsMock.mockReset();
    useSessionMock.mockReset();
    useSessionMock.mockReturnValue({
      data: {
        user: { id: "user_1" },
        session: { activeOrganizationId: null },
      },
    });
    getUsersByIdOrganizationsMock.mockResolvedValue({ data: { data: [] } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops a file deleted elsewhere before the refetch returns while open", async () => {
    const queryClient = createQueryClient();
    const keepFile = makeFile("keep.pdf");
    const deletedFile = makeFile("remove-me.pdf");
    const refetchDeferred = Promise.withResolvers<DriveItem[]>();

    listDriveItemsMock
      .mockResolvedValueOnce([keepFile, deletedFile])
      .mockImplementationOnce(() => refetchDeferred.promise);

    render(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /remove-me\.pdf/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /keep\.pdf/ }),
    ).toBeInTheDocument();

    await act(async () => {
      void invalidateDrive(
        queryClient,
        { scope: "me" },
        { deletedIds: [deletedFile.pathname] },
      );
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /remove-me\.pdf/ }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /keep\.pdf/ }),
    ).toBeInTheDocument();
    expect(listDriveItemsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      refetchDeferred.resolve([keepFile]);
      await refetchDeferred.promise;
    });

    expect(
      screen.getByRole("button", { name: /keep\.pdf/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove-me\.pdf/ }),
    ).not.toBeInTheDocument();
  });

  it("drops a file deleted while closed before the reopen refetch returns", async () => {
    const queryClient = createQueryClient();
    const keepFile = makeFile("keep.pdf");
    const deletedFile = makeFile("stale-file.pdf");
    const refetchDeferred = Promise.withResolvers<DriveItem[]>();

    listDriveItemsMock
      .mockResolvedValueOnce([keepFile, deletedFile])
      .mockImplementationOnce(() => refetchDeferred.promise);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /stale-file\.pdf/ }),
    ).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker
          open={false}
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await act(async () => {
      await invalidateDrive(
        queryClient,
        { scope: "me" },
        { deletedIds: [deletedFile.pathname] },
      );
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /keep\.pdf/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /stale-file\.pdf/ }),
    ).not.toBeInTheDocument();
    expect(listDriveItemsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      refetchDeferred.resolve([keepFile]);
      await refetchDeferred.promise;
    });
  });

  it("reopens unchanged with the cached list and makes no GET", async () => {
    const queryClient = createQueryClient();
    const cachedFile = makeFile("cached-brief.pdf");
    listDriveItemsMock.mockResolvedValue([cachedFile]);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /cached-brief\.pdf/ }),
    ).toBeEnabled();
    expect(listDriveItemsMock).toHaveBeenCalledTimes(1);

    rerender(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker
          open={false}
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </QueryClientProvider>,
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /cached-brief\.pdf/ }),
    ).toBeEnabled();
    expect(listDriveItemsMock).toHaveBeenCalledTimes(1);
  });

  it("disables cached rows on reopen after a Drive write until the refetch returns", async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    const staleFile = makeFile("stale.pdf");
    const freshFile = makeFile("fresh.pdf");
    const docsFolder = makeFolder("docs");
    const refetchDeferred = Promise.withResolvers<DriveItem[]>();
    const onSelect = vi.fn();

    listDriveItemsMock
      .mockResolvedValueOnce([docsFolder, staleFile])
      .mockImplementationOnce(() => refetchDeferred.promise);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={vi.fn()} onSelect={onSelect} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /stale\.pdf/ }),
    ).toBeEnabled();

    rerender(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker
          open={false}
          onOpenChange={vi.fn()}
          onSelect={onSelect}
        />
      </QueryClientProvider>,
    );

    await act(async () => {
      await invalidateDrive(queryClient, { scope: "me" });
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={vi.fn()} onSelect={onSelect} />
      </QueryClientProvider>,
    );

    const staleButton = await screen.findByRole("button", {
      name: /stale\.pdf/,
    });
    const folderButton = screen.getByRole("button", { name: /docs/ });
    expect(staleButton).toBeDisabled();
    expect(folderButton).toBeDisabled();
    await user.click(staleButton);
    expect(onSelect).not.toHaveBeenCalled();
    expect(listDriveItemsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      refetchDeferred.resolve([freshFile]);
      await refetchDeferred.promise;
    });

    const freshButton = await screen.findByRole("button", {
      name: /fresh\.pdf/,
    });
    expect(freshButton).toBeEnabled();
    await user.click(freshButton);
    expect(onSelect).toHaveBeenCalledWith(freshFile);
  });

  it("resolves organization name, filters non-pickable items, navigates folders, and isolates workspaces", async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();

    useSessionMock.mockReturnValue({
      data: {
        user: { id: "user_1" },
        session: { activeOrganizationId: "org_a" },
      },
    });
    getUsersByIdOrganizationsMock.mockResolvedValue({
      data: {
        data: [
          { id: "org_a", name: "Acme Corp" },
          { id: "org_b", name: "Beta Labs" },
        ],
      },
    });

    const orgAFile = makeFile("org-a.pdf", {
      pathname: "drive/orgs/org_a/org-a.pdf",
    });
    const folderMarker = makeFile("__drive_folder__", {
      pathname: "drive/orgs/org_a/__drive_folder__",
    });
    const roomFile = makeFile("secret.pdf", {
      pathname: "drive/orgs/org_a/room/secret.pdf",
      dataRoom: true,
    });
    const docsFolder = makeFolder("docs");
    const docsFile = makeFile("nested.pdf", {
      pathname: "drive/orgs/org_a/docs/nested.pdf",
    });
    const orgBFile = makeFile("org-b.pdf", {
      pathname: "drive/orgs/org_b/org-b.pdf",
    });

    listDriveItemsMock.mockImplementation(
      async (opts: {
        scope: string;
        organizationId?: string;
        folder?: string;
      }) => {
        if (opts.organizationId === "org_b") {
          return [orgBFile];
        }
        if (opts.folder === "docs") {
          return [docsFile];
        }
        return [orgAFile, folderMarker, roomFile, docsFolder];
      },
    );

    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={onOpenChange} onSelect={onSelect} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Acme Corp" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /org-a\.pdf/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /secret\.pdf/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /__drive_folder__/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /docs/ }));
    expect(
      await screen.findByRole("button", { name: /nested\.pdf/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Acme Corp" }));
    expect(
      await screen.findByRole("button", { name: /org-a\.pdf/ }),
    ).toBeInTheDocument();

    // Switch to workspace B: org A's rows must not appear under org B.
    useSessionMock.mockReturnValue({
      data: {
        user: { id: "user_1" },
        session: { activeOrganizationId: "org_b" },
      },
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={onOpenChange} onSelect={onSelect} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /org-b\.pdf/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /org-a\.pdf/ }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Beta Labs" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /org-b\.pdf/ }));
    expect(onSelect).toHaveBeenCalledWith(orgBFile);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows an error on failure and retries when reopened", async () => {
    const queryClient = createQueryClient();
    const recoveredFile = makeFile("recovered.pdf");

    listDriveItemsMock
      .mockRejectedValueOnce(new Error("Drive unavailable"))
      .mockResolvedValueOnce([recoveredFile]);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Drive unavailable")).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker
          open={false}
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </QueryClientProvider>,
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <DriveFilePicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /recovered\.pdf/ }),
    ).toBeInTheDocument();
  });
});
