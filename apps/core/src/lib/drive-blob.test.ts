import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => {
  class BlobNotFoundError extends Error {}
  return {
    BlobNotFoundError,
    head: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    rename: vi.fn(),
  };
});
vi.mock("@vercel/blob", () => blob);
const env = vi.hoisted(() => ({
  value: {
    BLOB_READ_WRITE_TOKEN: "public-token",
    DATA_ROOM_BLOB_READ_WRITE_TOKEN: "private-token",
  } as Record<string, string | undefined>,
}));
vi.mock("@/config/env", () => ({ getEnv: () => env.value }));
const db = vi.hoisted(() => ({ dataRoom: { findMany: vi.fn() } }));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

import {
  driveDel,
  driveHead,
  driveList,
  drivePut,
  forgetDriveRooms,
  isInDataRoom,
  publicDriveUrl,
} from "./drive-blob";

const OWNER = "drive/organizations/org_1/";

/** A store that holds the listed pathnames, answering by token. */
function stores(objects: { public: string[]; private: string[] }) {
  const byToken: Record<string, string[]> = {
    "public-token": objects.public,
    "private-token": objects.private,
  };
  blob.head.mockImplementation(
    async (pathname: string, options: { token: string }) => {
      if (byToken[options.token]?.includes(pathname))
        return { url: `https://${options.token}/${pathname}`, size: 1 };
      throw new blob.BlobNotFoundError("missing");
    },
  );
  blob.list.mockImplementation(
    async (options: { prefix: string; token: string; cursor?: string }) => ({
      blobs: (byToken[options.token] ?? [])
        .filter((pathname) => pathname.startsWith(options.prefix))
        .map((pathname) => ({
          pathname,
          url: `https://${options.token}/${pathname}`,
          size: 1,
          uploadedAt: new Date(0),
        })),
      hasMore: false,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetDriveRooms();
  env.value = {
    BLOB_READ_WRITE_TOKEN: "public-token",
    DATA_ROOM_BLOB_READ_WRITE_TOKEN: "private-token",
  };
  db.dataRoom.findMany.mockResolvedValue([
    { folderPath: "Series A", storage: "PRIVATE" },
  ]);
});

describe("writes", () => {
  it("writes inside a room to the private store, everywhere else to the public one", async () => {
    blob.put.mockImplementation(async (pathname: string) => ({
      url: `https://x/${pathname}`,
      pathname,
    }));
    await drivePut(`${OWNER}Series A/deck.pdf`, "x");
    await drivePut(`${OWNER}Series AB/deck.pdf`, "x");
    expect(blob.put.mock.calls[0][2]).toMatchObject({
      access: "private",
      token: "private-token",
    });
    // A sibling whose name only starts the same is not in the room.
    expect(blob.put.mock.calls[1][2]).toMatchObject({
      access: "public",
      token: "public-token",
    });
  });

  it("writes back to the public store while a room is closing", async () => {
    db.dataRoom.findMany.mockResolvedValue([
      { folderPath: "Series A", storage: "MOVING_OUT" },
    ]);
    blob.put.mockResolvedValue({ url: "u", pathname: "p" });
    await drivePut(`${OWNER}Series A/deck.pdf`, "x");
    expect(blob.put.mock.calls[0][2]).toMatchObject({ access: "public" });
  });

  it("never asks the database when the private store is not set up", async () => {
    env.value = { BLOB_READ_WRITE_TOKEN: "public-token" };
    blob.put.mockResolvedValue({ url: "u", pathname: "p" });
    await drivePut(`${OWNER}Series A/deck.pdf`, "x");
    expect(db.dataRoom.findMany).not.toHaveBeenCalled();
    expect(blob.put.mock.calls[0][2]).toMatchObject({ access: "public" });
  });
});

describe("reads", () => {
  it("finds a file still in the public store while its room is moving in", async () => {
    db.dataRoom.findMany.mockResolvedValue([
      { folderPath: "Series A", storage: "MOVING_IN" },
    ]);
    stores({ public: [`${OWNER}Series A/deck.pdf`], private: [] });
    await expect(driveHead(`${OWNER}Series A/deck.pdf`)).resolves.toMatchObject(
      {
        access: "public",
      },
    );
  });

  it("answers null when no store has the file", async () => {
    stores({ public: [], private: [] });
    await expect(driveHead(`${OWNER}Series A/gone.pdf`)).resolves.toBeNull();
  });

  it("deletes from both stores, so nothing is left behind mid-move", async () => {
    await driveDel([`${OWNER}Series A/deck.pdf`]);
    expect(blob.del).toHaveBeenCalledWith([`${OWNER}Series A/deck.pdf`], {
      token: "private-token",
    });
    expect(blob.del).toHaveBeenCalledWith([`${OWNER}Series A/deck.pdf`], {
      token: "public-token",
    });
  });
});

describe("leaving Sokosumi", () => {
  it("never hands out a URL for a file in a room", async () => {
    stores({ public: [], private: [`${OWNER}Series A/deck.pdf`] });
    await expect(
      publicDriveUrl(`${OWNER}Series A/deck.pdf`),
    ).resolves.toBeNull();
    await expect(isInDataRoom(`${OWNER}Series A/deck.pdf`)).resolves.toBe(true);
  });

  it("hands out the public URL of an ordinary file", async () => {
    stores({ public: [`${OWNER}Notes/plan.md`], private: [] });
    await expect(publicDriveUrl(`${OWNER}Notes/plan.md`)).resolves.toBe(
      `https://public-token/${OWNER}Notes/plan.md`,
    );
  });

  it("still knows a room without the private store, so nothing leaks", async () => {
    env.value = { BLOB_READ_WRITE_TOKEN: "public-token" };
    await expect(isInDataRoom(`${OWNER}Series A/deck.pdf`)).resolves.toBe(true);
  });
});

describe("listings", () => {
  const files = {
    public: [`${OWNER}Notes/plan.md`],
    private: [`${OWNER}Series A/deck.pdf`, `${OWNER}Series A/cap-table.xlsx`],
  };

  it("lists a room from the private store alone", async () => {
    stores(files);
    const page = await driveList({ prefix: `${OWNER}Series A/` });
    expect(page.blobs.map((b) => [b.pathname, b.access])).toEqual([
      [`${OWNER}Series A/deck.pdf`, "private"],
      [`${OWNER}Series A/cap-table.xlsx`, "private"],
    ]);
    expect(blob.list).toHaveBeenCalledTimes(1);
  });

  it("fills the rest of the page from the private store once the public one runs out", async () => {
    stores(files);
    const first = await driveList({ prefix: OWNER });
    expect(first.blobs.map((b) => [b.pathname, b.access])).toEqual([
      [`${OWNER}Notes/plan.md`, "public"],
      [`${OWNER}Series A/deck.pdf`, "private"],
      [`${OWNER}Series A/cap-table.xlsx`, "private"],
    ]);
    expect(first.hasMore).toBe(false);
  });

  it("shows a room's folder on the first page when nothing else is public", async () => {
    blob.list.mockImplementation(async (options: { token: string }) =>
      options.token === "public-token"
        ? { blobs: [], folders: [], hasMore: false }
        : { blobs: [], folders: [`${OWNER}Series A/`], hasMore: false },
    );
    const page = await driveList({ prefix: OWNER, mode: "folded" });
    expect(page.folders).toEqual([`${OWNER}Series A/`]);
    expect(page.hasMore).toBe(false);
  });

  it("merges both stores while a room is moving, keeping one of each pathname", async () => {
    db.dataRoom.findMany.mockResolvedValue([
      { folderPath: "Series A", storage: "MOVING_IN" },
    ]);
    stores({
      public: [`${OWNER}Series A/deck.pdf`, `${OWNER}Series A/memo.md`],
      private: [`${OWNER}Series A/deck.pdf`],
    });
    const page = await driveList({ prefix: `${OWNER}Series A/` });
    expect(page.blobs.map((b) => [b.pathname, b.access])).toEqual([
      [`${OWNER}Series A/deck.pdf`, "private"],
      [`${OWNER}Series A/memo.md`, "public"],
    ]);
  });

  it("leaves an owner without rooms on the public store, cursor and all", async () => {
    db.dataRoom.findMany.mockResolvedValue([]);
    blob.list.mockResolvedValue({ blobs: [], hasMore: true, cursor: "c2" });
    const page = await driveList({ prefix: OWNER, cursor: "c1" });
    expect(blob.list).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "c1", token: "public-token" }),
    );
    expect(page.cursor).toBe("c2");
  });
});
