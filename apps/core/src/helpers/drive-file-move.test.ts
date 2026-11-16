import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => {
  class BlobNotFoundError extends Error {}
  return {
    BlobNotFoundError,
    head: vi.fn(),
    list: vi.fn(),
    rename: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock("@vercel/blob", () => blob);
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    BLOB_READ_WRITE_TOKEN: "public-token",
    DATA_ROOM_BLOB_READ_WRITE_TOKEN: "private-token",
  }),
}));
const db = vi.hoisted(() => ({ dataRoom: { findMany: vi.fn() } }));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
const reconcile = vi.hoisted(() => vi.fn());
vi.mock("@/services/file-catalog.service", () => ({
  reconcileDriveUploadMoves: reconcile,
}));

import { forgetDriveRooms } from "@/lib/drive-blob";
import { moveDriveFile } from "./drive-file-move";

const base = {
  sourcePathname: "drive/organizations/org_1/deck.pdf",
  scope: "organization" as const,
  ownerId: "org_1",
  workspaceId: "ws_1",
};

describe("moveDriveFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetDriveRooms();
    db.dataRoom.findMany.mockResolvedValue([]);
    blob.list.mockResolvedValue({ blobs: [], hasMore: false });
    blob.rename.mockImplementation(async (_from: string, to: string) => ({
      url: `https://public.example/${to}`,
      pathname: to,
    }));
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

  it("moves a file into a data room across stores, never by rename", async () => {
    db.dataRoom.findMany.mockResolvedValue([
      { folderPath: "Series A", storage: "PRIVATE" },
    ]);
    blob.head.mockImplementation(
      async (pathname: string, options: { token: string }) => {
        if (
          pathname === base.sourcePathname &&
          options.token === "public-token"
        )
          return { contentType: "application/pdf", cacheControl: "" };
        throw new blob.BlobNotFoundError("missing");
      },
    );
    const stream = new ReadableStream();
    blob.get.mockResolvedValue({
      statusCode: 200,
      stream,
      blob: { contentType: "application/pdf" },
    });
    blob.put.mockImplementation(async (pathname: string) => ({
      url: `https://private.example/${pathname}`,
      pathname,
    }));

    await expect(
      moveDriveFile({ ...base, targetFolderPath: "Series A" }),
    ).resolves.toBe("drive/organizations/org_1/Series A/deck.pdf");

    expect(blob.rename).not.toHaveBeenCalled();
    expect(blob.get).toHaveBeenCalledWith(base.sourcePathname, {
      access: "public",
      token: "public-token",
    });
    expect(blob.put).toHaveBeenCalledWith(
      "drive/organizations/org_1/Series A/deck.pdf",
      stream,
      expect.objectContaining({ access: "private", token: "private-token" }),
    );
    expect(blob.del).toHaveBeenCalledWith(base.sourcePathname, {
      token: "public-token",
    });
  });
});
