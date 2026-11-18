import { expectConsole } from "@sokosumi/utils/test-console";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyFileName } from "@/app/drive/components/drive-recents-list.utils";
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
  copyMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/utils/drive-recents-list.client", () => ({
  fetchDriveRecentsPage: fetchRecentsMock,
}));

vi.mock("@sokosumi/core-client", () => ({ postDriveFilesCopy: copyMock }));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => "core-client",
}));

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

function renderPanel(onItemsChanged = vi.fn()) {
  render(
    <DriveRecentsPanel
      driveStore={{ scope: "me" }}
      activeOrganizationId={null}
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
});

describe("copyFileName", () => {
  it("puts the label before the extension", () => {
    expect(copyFileName("weekly.md", "copy")).toBe("weekly (copy).md");
    expect(copyFileName("Q4 plan.final.pdf", "Kopie")).toBe(
      "Q4 plan.final (Kopie).pdf",
    );
  });

  it("appends the label when there is no extension", () => {
    expect(copyFileName("README", "copy")).toBe("README (copy)");
    expect(copyFileName(".env", "copy")).toBe(".env (copy)");
  });
});

describe("Make a copy", () => {
  it("copies the file beside itself and reloads the list", async () => {
    copyMock.mockResolvedValue({
      data: { data: { name: "weekly (copy).md" } },
    });
    const user = userEvent.setup();
    const onItemsChanged = renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "moreActions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "makeCopyAction" }));

    await waitFor(() =>
      expect(copyMock).toHaveBeenCalledWith({
        client: "core-client",
        body: {
          pathname: "drive/users/u1/briefs/weekly.md",
          filename: "weekly (copyNameLabel).md",
        },
        throwOnError: true,
      }),
    );
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        "copyMade:weekly (copy).md",
      ),
    );
    expect(onItemsChanged).toHaveBeenCalled();
    expect(fetchRecentsMock).toHaveBeenCalledTimes(2);
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
      expect(toastMock.error).toHaveBeenCalledWith("copyError"),
    );
    expect(onItemsChanged).not.toHaveBeenCalled();
    expect(screen.getByText("weekly.md")).toBeInTheDocument();
  });
});
