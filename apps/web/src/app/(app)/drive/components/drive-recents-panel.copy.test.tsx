import { expectConsole } from "@sokosumi/utils/test-console";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DriveRecentsPanel } from "@/app/drive/components/drive-recents-panel";

// Stable references: the panel reloads whenever `t` changes identity.
const { t, formatter } = vi.hoisted(() => ({
  t: (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
  formatter: { dateTime: () => "18 Nov 2026" },
}));
vi.mock("next-intl", () => ({
  useTranslations: () => t,
  useFormatter: () => formatter,
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({ locale: "en" }),
}));

const { fetchRecentsMock, copyMock, toastMock } = vi.hoisted(() => ({
  fetchRecentsMock: vi.fn(),
  /** The existing upload path; a copy is an upload of the file's bytes. */
  copyMock: vi.fn(),
  toastMock: {
    loading: vi.fn(() => "toast-1"),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/utils/drive-recents-list.client", () => ({
  fetchDriveRecentsPage: fetchRecentsMock,
}));

vi.mock("@/lib/utils/drive-file-upload.client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/utils/drive-file-upload.client")
  >()),
  uploadDriveFile: copyMock,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("sonner", () => ({ toast: toastMock }));

const FILE = {
  kind: "drive-file" as const,
  name: "weekly.md",
  fileUrl: "https://blob.example/drive/users/u1/briefs/weekly.md",
  pathname: "drive/users/u1/briefs/weekly.md",
  size: 42,
  activityAt: new Date("2026-11-18T09:00:00Z"),
  resourceId: "res_1",
  category: null,
  tags: [],
  dataRoom: false,
};

function renderPanel(
  onItemsChanged = vi.fn(),
  store: { scope: "me" } | { scope: "org"; organizationId: string } = {
    scope: "me",
  },
) {
  render(
    <DriveRecentsPanel
      driveStore={store}
      activeOrganizationId={store.scope === "org" ? "org_1" : null}
      searchQuery=""
      tagLabelIds={[]}
      onOpenMoveDialog={vi.fn()}
      onShareFile={vi.fn()}
      onOpenDeleteDialog={vi.fn()}
      onRenameFile={vi.fn()}
      onOpenCopyDialog={vi.fn()}
      onItemsChanged={onItemsChanged}
      onUpload={vi.fn()}
      uploading={false}
      onOpenWorkspace={vi.fn()}
    />,
  );
  return onItemsChanged;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchRecentsMock.mockResolvedValue({ items: [FILE], nextCursor: null });
  fetchMock.mockResolvedValue(
    new Response(new Blob(["# weekly"], { type: "text/markdown" })),
  );
});

/** Names of the files handed to the upload, in order. */
const uploadedNames = () =>
  copyMock.mock.calls.map(([file]) => (file as File).name);

describe("Make a copy", () => {
  it("lets a Recents name wrap to two lines on a phone, so its end stays visible", async () => {
    renderPanel();

    expect(await screen.findByText("weekly.md")).toHaveClass(
      "line-clamp-2",
      "md:line-clamp-1",
    );
  });

  it("uploads the file's bytes beside it as a new, label-free file and reloads the list", async () => {
    copyMock.mockResolvedValue({
      pathname: "drive/users/u1/briefs/weekly_copy_0a1b2c3d4e.md",
      fileUrl: "u",
    });
    const user = userEvent.setup();
    const onItemsChanged = renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "moreActions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "makeCopyAction" }));

    await waitFor(() => expect(copyMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(FILE.fileUrl);
    const [file, options] = copyMock.mock.calls[0];
    expect((file as File).name).toBe("weekly (copyNameLabel).md");
    expect(await (file as File).text()).toBe("# weekly");
    expect(options).toEqual({
      scope: "me",
      folder: "briefs",
      pinLabelsEmpty: true,
    });
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        "copyMade:weekly_copy_0a1b2c3d4e.md",
        { id: "toast-1" },
      ),
    );
    expect(onItemsChanged).toHaveBeenCalled();
    expect(fetchRecentsMock).toHaveBeenCalledTimes(2);
  });

  it("takes the next name when one is already taken", async () => {
    const { DriveFileUploadError } = await import(
      "@/lib/utils/drive-file-upload.client"
    );
    copyMock
      .mockRejectedValueOnce(new DriveFileUploadError("duplicate", "taken"))
      .mockResolvedValueOnce({ pathname: "drive/x/p", fileUrl: "u" });
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "moreActions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "makeCopyAction" }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(uploadedNames()).toEqual([
      "weekly (copyNameLabel).md",
      "weekly (copyNameLabel) 2.md",
    ]);
  });

  it("says so when the copy fails and keeps the list", async () => {
    expectConsole("error", "Failed to copy Drive file");
    copyMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    const onItemsChanged = renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "moreActions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "makeCopyAction" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("copyError", {
        id: "toast-1",
      }),
    );
    expect(onItemsChanged).not.toHaveBeenCalled();
    expect(screen.getByText("weekly.md")).toBeInTheDocument();
  });

  it("shows progress and blocks a second copy of the same file until the first lands", async () => {
    let finish: (value: unknown) => void = () => undefined;
    copyMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "moreActions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "makeCopyAction" }));
    expect(toastMock.loading).toHaveBeenCalledWith("copying:weekly.md");

    await user.click(screen.getByRole("button", { name: "moreActions" }));
    const item = screen.getByRole("menuitem", { name: "makeCopyAction" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    await user.click(item);
    expect(copyMock).toHaveBeenCalledTimes(1);

    finish({ pathname: "drive/x/p", fileUrl: "u" });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it.each([
    [
      "an organization file",
      { scope: "org" as const, organizationId: "org_1" },
      FILE,
    ],
    ["a data-room file", { scope: "me" as const }, { ...FILE, dataRoom: true }],
  ])("is not offered for %s", async (_case, store, item) => {
    fetchRecentsMock.mockResolvedValue({ items: [item], nextCursor: null });
    const user = userEvent.setup();
    renderPanel(vi.fn(), store);

    await user.click(
      await screen.findByRole("button", { name: "moreActions" }),
    );

    expect(
      screen.getByRole("menuitem", { name: "renameAction" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "makeCopyAction" }),
    ).not.toBeInTheDocument();
  });
});
