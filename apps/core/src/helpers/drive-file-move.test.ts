import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => {
  class BlobNotFoundError extends Error {}
  class BlobPreconditionFailedError extends Error {}
  return {
    BlobNotFoundError,
    BlobPreconditionFailedError,
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
const catalog = vi.hoisted(() => ({
  adoptDriveUploadResource: vi.fn(),
  moveDriveUploadResource: vi.fn(),
}));
vi.mock("@/services/file-catalog.service", () => catalog);

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
    catalog.adoptDriveUploadResource.mockResolvedValue("res_1");
    catalog.moveDriveUploadResource.mockResolvedValue("deck.pdf");
  });

  const TARGET = "drive/organizations/org_1/Masumi Fundraising/deck.pdf";

  function sourceOnly() {
    blob.head.mockImplementation(async (pathname: string) => {
      if (pathname === base.sourcePathname)
        return { contentType: "application/pdf", cacheControl: "max-age=60" };
      throw new blob.BlobNotFoundError("missing");
    });
  }

  it("moves the catalog row first, then the bytes", async () => {
    sourceOnly();
    const order: string[] = [];
    catalog.moveDriveUploadResource.mockImplementation(async () => {
      order.push("catalog");
      return "deck.pdf";
    });
    blob.rename.mockImplementation(async (_from: string, to: string) => {
      order.push("storage");
      return { url: `https://public.example/${to}`, pathname: to };
    });
    await expect(
      moveDriveFile({ ...base, targetFolderPath: "Masumi Fundraising" }),
    ).resolves.toBe(TARGET);
    expect(order).toEqual(["catalog", "storage"]);
    expect(catalog.moveDriveUploadResource).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      scope: "organization",
      resourceId: "res_1",
      fromPathname: base.sourcePathname,
      toPathname: TARGET,
      displayName: "deck.pdf",
    });
    expect(blob.rename).toHaveBeenCalledWith(
      base.sourcePathname,
      TARGET,
      expect.objectContaining({ cacheControlMaxAge: 60 }),
    );
  });

  it("leaves the bytes where they are when another document holds the name", async () => {
    sourceOnly();
    catalog.moveDriveUploadResource.mockRejectedValue(
      Object.assign(new Error("A file already holds that name"), {
        status: 409,
      }),
    );
    await expect(
      moveDriveFile({ ...base, targetFolderPath: "Masumi Fundraising" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(blob.rename).not.toHaveBeenCalled();
  });

  it("puts the row back when storage fails with the source still there", async () => {
    sourceOnly();
    blob.rename.mockRejectedValue(new Error("network"));
    await expect(
      moveDriveFile({ ...base, targetFolderPath: "Masumi Fundraising" }),
    ).rejects.toThrow("network");
    expect(catalog.moveDriveUploadResource).toHaveBeenLastCalledWith({
      workspaceId: "ws_1",
      scope: "organization",
      resourceId: "res_1",
      fromPathname: TARGET,
      toPathname: base.sourcePathname,
      displayName: "deck.pdf",
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

  describe("a transfer into a room that half succeeds", () => {
    const ROOM_TARGET = "drive/organizations/org_1/Series A/deck.pdf";

    /** Separate public and private stores, by token. */
    function twoStores() {
      const objects: Record<
        string,
        Map<string, { size: number; etag: string }>
      > = {
        "public-token": new Map([
          [base.sourcePathname, { size: 9, etag: '"src"' }],
        ]),
        "private-token": new Map(),
      };
      blob.head.mockImplementation(
        async (pathname: string, options: { token: string }) => {
          const object = objects[options.token].get(pathname);
          if (!object) throw new blob.BlobNotFoundError("missing");
          return {
            ...object,
            url: `https://${options.token}/${pathname}`,
            contentType: "application/pdf",
            cacheControl: "",
            uploadedAt: new Date(0),
          };
        },
      );
      blob.get.mockResolvedValue({
        statusCode: 200,
        stream: new ReadableStream(),
        blob: { contentType: "application/pdf" },
      });
      blob.put.mockImplementation(
        async (
          pathname: string,
          _body: unknown,
          options: { token: string },
        ) => {
          objects[options.token].set(pathname, { size: 9, etag: '"dst"' });
          return { url: `https://private/${pathname}`, pathname };
        },
      );
      return objects;
    }

    beforeEach(() => {
      db.dataRoom.findMany.mockResolvedValue([
        { folderPath: "Series A", storage: "PRIVATE" },
      ]);
    });

    it("keeps the row with the bytes it wrote and retries the streamed source's cleanup", async () => {
      const objects = twoStores();
      blob.get.mockResolvedValue({
        statusCode: 200,
        stream: new ReadableStream(),
        blob: { contentType: "application/pdf", etag: '"src"' },
      });
      // The transfer's own source delete fails; the retry succeeds.
      blob.del
        .mockRejectedValueOnce(new Error("store 503"))
        .mockImplementationOnce(async (pathname: string) => {
          objects["public-token"].delete(pathname);
        });

      await expect(
        moveDriveFile({ ...base, targetFolderPath: "Series A" }),
      ).resolves.toBe(ROOM_TARGET);

      expect(catalog.moveDriveUploadResource).toHaveBeenCalledTimes(1);
      expect(blob.del).toHaveBeenLastCalledWith(base.sourcePathname, {
        token: "public-token",
        ifMatch: '"src"',
      });
      expect(objects["public-token"].has(base.sourcePathname)).toBe(false);
    });

    it("never takes a same-size object it did not write for the moved file", async () => {
      const objects = twoStores();
      // The source read fails before any write, while an unrelated
      // same-size object lands at the destination.
      blob.get.mockImplementation(async () => {
        objects["private-token"].set(ROOM_TARGET, { size: 9, etag: '"x"' });
        throw new Error("read reset");
      });

      await expect(
        moveDriveFile({ ...base, targetFolderPath: "Series A" }),
      ).rejects.toThrow("read reset");

      expect(objects["public-token"].has(base.sourcePathname)).toBe(true);
      expect(blob.del).not.toHaveBeenCalled();
      expect(catalog.moveDriveUploadResource).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fromPathname: ROOM_TARGET,
          toPathname: base.sourcePathname,
        }),
      );
    });

    it("keeps a source replaced during the transfer", async () => {
      const objects = twoStores();
      blob.get.mockResolvedValue({
        statusCode: 200,
        stream: new ReadableStream(),
        blob: { contentType: "application/pdf", etag: '"src"' },
      });
      blob.del.mockImplementation(
        async (pathname: string, options: { ifMatch?: string }) => {
          // Replaced mid-transfer: the precondition no longer holds.
          if (options.ifMatch === '"src"')
            throw new blob.BlobPreconditionFailedError("etag");
          objects["public-token"].delete(pathname);
        },
      );

      await expect(
        moveDriveFile({ ...base, targetFolderPath: "Series A" }),
      ).resolves.toBe(ROOM_TARGET);
      expect(objects["public-token"].has(base.sourcePathname)).toBe(true);
    });

    it("puts the row back when the destination never got the bytes", async () => {
      twoStores();
      blob.put.mockRejectedValue(new Error("store 503"));

      await expect(
        moveDriveFile({ ...base, targetFolderPath: "Series A" }),
      ).rejects.toThrow("store 503");

      expect(catalog.moveDriveUploadResource).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fromPathname: ROOM_TARGET,
          toPathname: base.sourcePathname,
        }),
      );
      expect(blob.del).not.toHaveBeenCalled();
    });
  });

  it("moves no bytes a deleted document still owns", async () => {
    sourceOnly();
    catalog.adoptDriveUploadResource.mockResolvedValue(null);

    await expect(
      moveDriveFile({ ...base, targetFolderPath: "Masumi Fundraising" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(catalog.moveDriveUploadResource).not.toHaveBeenCalled();
    expect(blob.rename).not.toHaveBeenCalled();
  });
});
