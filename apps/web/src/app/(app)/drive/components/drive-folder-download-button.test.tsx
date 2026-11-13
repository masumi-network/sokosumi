import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

const listDriveItems = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/drive-file-list.client", () => ({ listDriveItems }));
const toast = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
const archive = vi.hoisted(() => ({
  createFilesArchive: vi.fn(),
  saveZip: vi.fn(),
}));
vi.mock("@/lib/files-archive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files-archive")>()),
  ...archive,
}));

import {
  DriveFolderDownloadButton,
  FOLDER_ARCHIVE_MAX_FILES,
} from "./drive-folder-download-button";

const store = { scope: "org" as const, organizationId: "org_1" };
const file = (name: string) => ({
  type: "file",
  name,
  fileUrl: `https://blob.test/${name}`,
});
const folder = (name: string) => ({
  type: "folder",
  name,
  path: name,
  dataRoom: false,
});

function renderButton() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DriveFolderDownloadButton
        store={store}
        folder="Clients/Acme"
        name="Acme"
      />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("button", { name: "Download Acme as a zip" });
}

describe("DriveFolderDownloadButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it("zips every file below the folder with subfolders as paths", async () => {
    listDriveItems.mockImplementation(
      async ({ folder: path }) =>
        ({
          "Clients/Acme": [folder("Brand"), file("brief.pdf")],
          "Clients/Acme/Brand": [file("logo.png"), folder("Old")],
          "Clients/Acme/Brand/Old": [file("logo.png")],
        })[path as string],
    );
    archive.createFilesArchive.mockResolvedValue({
      data: new ArrayBuffer(1),
      included: ["Brand/logo.png", "Brand/Old/logo.png"],
      missing: ["brief.pdf"],
    });

    await userEvent.click(renderButton());

    await waitFor(() =>
      expect(archive.saveZip).toHaveBeenCalledWith(expect.anything(), "Acme"),
    );
    expect(listDriveItems).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "org", organizationId: "org_1" }),
    );
    expect(archive.createFilesArchive).toHaveBeenCalledWith(
      [
        {
          name: "logo.png",
          fileUrl: "https://blob.test/logo.png",
          folder: "Brand",
        },
        {
          name: "logo.png",
          fileUrl: "https://blob.test/logo.png",
          folder: "Brand/Old",
        },
        { name: "brief.pdf", fileUrl: "https://blob.test/brief.pdf" },
      ],
      expect.any(AbortSignal),
      expect.any(Number),
      FOLDER_ARCHIVE_MAX_FILES,
    );
    expect(toast.warning).toHaveBeenCalledWith(
      "Downloaded 2 of 3 files. Not included: brief.pdf. Open them one by one.",
      { duration: 15_000 },
    );
  });

  it("says so when the folder has no files", async () => {
    listDriveItems.mockImplementation(async ({ folder: path }) =>
      path === "Clients/Acme" ? [folder("Empty")] : [],
    );

    await userEvent.click(renderButton());

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        "There are no files to download yet.",
      ),
    );
    expect(archive.createFilesArchive).not.toHaveBeenCalled();
    expect(archive.saveZip).not.toHaveBeenCalled();
  });

  it("reports a failure when the folder cannot be listed", async () => {
    listDriveItems.mockRejectedValue(new Error("offline"));

    await userEvent.click(renderButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't download the files. Try again, or open them one by one.",
      ),
    );
  });
});
