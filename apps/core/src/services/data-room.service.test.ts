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
const db = vi.hoisted(() => {
  const tx = {
    driveShare: { deleteMany: vi.fn() },
    dataRoom: { create: vi.fn() },
  };
  return {
    tx,
    dataRoom: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    dataRoomColleague: { findUnique: vi.fn() },
    member: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
});
vi.mock("@/lib/db/prisma", () => ({ default: db }));
// The folder names only; the services behind them are not under test.
vi.mock("@/services/cmo-brand-media.service", () => ({
  CMO_BRAND_MEDIA_FOLDER: "Brand research",
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  IMAGE_STUDIO_DRIVE_FOLDER: "Content Studio",
}));
vi.mock("@/services/marketing-strategy-files.service", () => ({
  MARKETING_FILES_FOLDER: "Marketing",
}));

import { forgetDriveRooms } from "@/lib/drive-blob";
import {
  closeDataRoom,
  createDataRoom,
  moveDataRoomFiles,
} from "./data-room.service";

const store = {
  workspaceId: "ws_1",
  scope: "organization" as const,
  ownerId: "org_1",
};
const PREFIX = "drive/organizations/org_1/Series A/";

function folderHolds(pathnames: string[]) {
  const held = new Set(pathnames);
  blob.del.mockImplementation(async (pathname: string) => {
    held.delete(pathname);
  });
  blob.list.mockImplementation(async (options: { prefix: string }) => ({
    blobs: [...held]
      .filter((pathname) => pathname.startsWith(options.prefix))
      .map((pathname) => ({
        pathname,
        url: "u",
        size: 1,
        uploadedAt: new Date(0),
      })),
    hasMore: false,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetDriveRooms();
  env.value = {
    BLOB_READ_WRITE_TOKEN: "public-token",
    DATA_ROOM_BLOB_READ_WRITE_TOKEN: "private-token",
  };
  db.dataRoom.findMany.mockResolvedValue([]);
  db.tx.dataRoom.create.mockImplementation(async ({ data }) => ({
    id: "room-1",
    ...data,
  }));
  folderHolds([`${PREFIX}deck.pdf`]);
});

describe("createDataRoom", () => {
  it("makes the folder a room and removes every link into it", async () => {
    const room = await createDataRoom({
      store,
      folderPath: "/Series A/",
      userId: "u1",
    });
    expect(room).toMatchObject({ folderPath: "Series A" });
    expect(db.tx.driveShare.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        ownerId: "org_1",
        OR: [
          expect.objectContaining({
            kind: "FOLDER",
            OR: [
              { folderPath: "Series A" },
              { folderPath: { startsWith: "Series A/" } },
            ],
          }),
          {
            kind: "FILE",
            resource: { sourceId: { startsWith: PREFIX } },
          },
        ],
      }),
    });
  });

  it("refuses without the private store", async () => {
    env.value = { BLOB_READ_WRITE_TOKEN: "public-token" };
    await expect(
      createDataRoom({ store, folderPath: "Series A", userId: "u1" }),
    ).rejects.toThrow("Data rooms are not set up here");
  });

  it("refuses a folder Sokosumi publishes from, and anything under it", async () => {
    await expect(
      createDataRoom({ store, folderPath: "Content Studio/Q4", userId: "u1" }),
    ).rejects.toThrow("cannot be a data room");
  });

  it("refuses all of Files", async () => {
    await expect(
      createDataRoom({ store, folderPath: "/", userId: "u1" }),
    ).rejects.toThrow("not all of Files");
  });

  it("refuses a folder that does not exist", async () => {
    folderHolds([]);
    await expect(
      createDataRoom({ store, folderPath: "Series A", userId: "u1" }),
    ).rejects.toThrow("Folder not found");
  });

  it("never puts a room inside another, or around one", async () => {
    db.dataRoom.findMany.mockResolvedValue([
      { folderPath: "Series A", storage: "PRIVATE" },
    ]);
    folderHolds([`${PREFIX}Legal/nda.pdf`, `${PREFIX}deck.pdf`]);
    await expect(
      createDataRoom({ store, folderPath: "Series A/Legal", userId: "u1" }),
    ).rejects.toThrow("already inside a data room");

    forgetDriveRooms();
    db.dataRoom.findMany.mockResolvedValue([
      { folderPath: "Series A/Legal", storage: "PRIVATE" },
    ]);
    await expect(
      createDataRoom({ store, folderPath: "Series A", userId: "u1" }),
    ).rejects.toThrow("holds a data room");
  });
});

describe("closeDataRoom", () => {
  const caller = {
    ...store,
    actor: {
      userId: "u2",
      organizationId: "org_1",
      kind: "interactive" as const,
    },
  };
  const room = {
    id: "room-1",
    sourceScope: "ORGANIZATION",
    ownerId: "org_1",
    createdByUserId: "u1",
  };

  it("only closes a room of this Drive", async () => {
    db.dataRoom.findFirst.mockResolvedValue(null);
    await expect(closeDataRoom(caller, "room-of-someone-else")).rejects.toThrow(
      "Data room not found",
    );
    expect(db.dataRoom.findFirst).toHaveBeenCalledWith({
      where: {
        id: "room-of-someone-else",
        sourceScope: "ORGANIZATION",
        ownerId: "org_1",
      },
    });
    expect(db.dataRoom.update).not.toHaveBeenCalled();
  });

  it("does not let a member outside the room close it", async () => {
    db.dataRoom.findFirst.mockResolvedValue(room);
    db.dataRoomColleague.findUnique.mockResolvedValue(null);
    db.member.findUnique.mockResolvedValue({ role: "member" });
    await expect(closeDataRoom(caller, "room-1")).rejects.toThrow(
      "Data room not found",
    );
    expect(db.dataRoom.update).not.toHaveBeenCalled();
  });

  it("lets a colleague close it", async () => {
    db.dataRoom.findFirst.mockResolvedValue(room);
    db.dataRoomColleague.findUnique.mockResolvedValue({ userId: "u2" });
    await closeDataRoom(caller, "room-1");
    expect(db.dataRoom.update).toHaveBeenCalledWith({
      where: { id: "room-1" },
      data: { storage: "MOVING_OUT" },
    });
  });
});

describe("moveDataRoomFiles", () => {
  const always = { shouldContinue: () => true };
  const room = {
    id: "room-1",
    workspaceId: "ws_1",
    sourceScope: "ORGANIZATION",
    ownerId: "org_1",
    folderPath: "Series A",
  };

  it("streams each file into the private store, deletes the public copy and marks the room private", async () => {
    db.dataRoom.findMany.mockResolvedValue([{ ...room, storage: "MOVING_IN" }]);
    const stream = new ReadableStream();
    blob.get.mockResolvedValue({
      statusCode: 200,
      stream,
      blob: { contentType: "application/pdf" },
    });
    blob.put.mockResolvedValue({ url: "u", pathname: `${PREFIX}deck.pdf` });

    const result = await moveDataRoomFiles(always);

    expect(result).toEqual({ rooms: 1, moved: 1, finished: 1 });
    expect(blob.list).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: PREFIX, token: "public-token" }),
    );
    expect(blob.put).toHaveBeenCalledWith(
      `${PREFIX}deck.pdf`,
      stream,
      expect.objectContaining({
        access: "private",
        token: "private-token",
        contentType: "application/pdf",
      }),
    );
    expect(blob.del).toHaveBeenCalledWith(`${PREFIX}deck.pdf`, {
      token: "public-token",
    });
    expect(db.dataRoom.updateMany).toHaveBeenCalledWith({
      where: { id: "room-1", storage: "MOVING_IN" },
      data: { storage: "PRIVATE" },
    });
  });

  it("skips a file another run already moved and leaves the room for the next run", async () => {
    db.dataRoom.findMany.mockResolvedValue([{ ...room, storage: "MOVING_IN" }]);
    blob.get.mockResolvedValue(null);
    await expect(moveDataRoomFiles(always)).resolves.toEqual({
      rooms: 1,
      moved: 0,
      finished: 0,
    });
    expect(blob.put).not.toHaveBeenCalled();
    expect(db.dataRoom.updateMany).not.toHaveBeenCalled();
  });

  it("marks the room private once the public store has nothing left of it", async () => {
    db.dataRoom.findMany.mockResolvedValue([{ ...room, storage: "MOVING_IN" }]);
    folderHolds([]);
    await expect(moveDataRoomFiles(always)).resolves.toEqual({
      rooms: 1,
      moved: 0,
      finished: 1,
    });
    expect(db.dataRoom.updateMany).toHaveBeenCalledWith({
      where: { id: "room-1", storage: "MOVING_IN" },
      data: { storage: "PRIVATE" },
    });
  });

  it("forgets a closed room once its files are back in the public store", async () => {
    db.dataRoom.findMany.mockResolvedValue([
      { ...room, storage: "MOVING_OUT" },
    ]);
    folderHolds([]);
    await moveDataRoomFiles(always);
    expect(blob.list).toHaveBeenCalledWith(
      expect.objectContaining({ token: "private-token" }),
    );
    expect(db.dataRoom.deleteMany).toHaveBeenCalledWith({
      where: { id: "room-1", storage: "MOVING_OUT" },
    });
  });

  it("stops when the cron's time is up", async () => {
    db.dataRoom.findMany.mockResolvedValue([{ ...room, storage: "MOVING_IN" }]);
    await expect(
      moveDataRoomFiles({ shouldContinue: () => false }),
    ).resolves.toEqual({ rooms: 0, moved: 0, finished: 0 });
    expect(blob.list).not.toHaveBeenCalled();
  });
});
