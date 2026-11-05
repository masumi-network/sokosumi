import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => {
  class BlobNotFoundError extends Error {}
  return {
    BlobNotFoundError,
    head: vi.fn(),
    list: vi.fn(),
    rename: vi.fn(),
  };
});
vi.mock("@vercel/blob", () => blob);
const reconcile = vi.hoisted(() => vi.fn());
vi.mock("@/services/file-catalog.service", () => ({
  reconcileDriveUploadMoves: reconcile,
}));

import { moveDriveFile } from "./drive-file-move";

const base = {
  sourcePathname: "drive/organizations/org_1/deck.pdf",
  scope: "organization" as const,
  ownerId: "org_1",
  workspaceId: "ws_1",
  token: "t",
};

describe("moveDriveFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blob.list.mockResolvedValue({ blobs: [] });
  });

  it("moves into the folder and tells the catalog", async () => {
    blob.head.mockImplementation(async (pathname: string) => {
      if (pathname === base.sourcePathname)
        return { contentType: "application/pdf", cacheControl: "max-age=60" };
      throw new blob.BlobNotFoundError("missing");
    });
    await expect(
      moveDriveFile({ ...base, targetFolderPath: "Masumi Fundraising" }),
    ).resolves.toBe("drive/organizations/org_1/Masumi Fundraising/deck.pdf");
    expect(blob.rename).toHaveBeenCalledWith(
      base.sourcePathname,
      "drive/organizations/org_1/Masumi Fundraising/deck.pdf",
      expect.objectContaining({ cacheControlMaxAge: 60 }),
    );
    expect(reconcile).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      scope: "organization",
      moves: [
        {
          fromPathname: base.sourcePathname,
          toPathname: "drive/organizations/org_1/Masumi Fundraising/deck.pdf",
        },
      ],
    });
  });

  it("refuses to overwrite a file already in the folder", async () => {
    blob.head.mockResolvedValue({
      contentType: "application/pdf",
      cacheControl: "",
    });
    await expect(
      moveDriveFile({ ...base, targetFolderPath: "Masumi Fundraising" }),
    ).rejects.toThrow("Target file already exists");
    expect(blob.rename).not.toHaveBeenCalled();
  });
});
