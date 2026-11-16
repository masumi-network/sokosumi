import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    BLOB_READ_WRITE_TOKEN: "public-token",
    DATA_ROOM_BLOB_READ_WRITE_TOKEN: "private-token",
  }),
}));
const db = vi.hoisted(() => ({
  dataRoom: { findMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

import { forgetDriveRooms } from "@/lib/drive-blob";
import {
  assertDataRoomMoveAllowed,
  deleteDataRoomsUnder,
  rebaseDataRooms,
} from "./data-room-paths.service";

const owner = { scope: "organization" as const, ownerId: "org_1" };

beforeEach(() => {
  vi.clearAllMocks();
  forgetDriveRooms();
});

describe("assertDataRoomMoveAllowed", () => {
  beforeEach(() => {
    db.dataRoom.findMany.mockResolvedValue([
      { folderPath: "Series A", storage: "PRIVATE" },
      { folderPath: "Deals/Acme", storage: "PRIVATE" },
    ]);
  });

  it("refuses to carry a room into another room", async () => {
    await expect(
      assertDataRoomMoveAllowed({
        ...owner,
        fromFolderPath: "Deals",
        toFolderPath: "Series A/Deals",
      }),
    ).rejects.toThrow("cannot go inside another data room");
  });

  it("lets a room move anywhere outside the others", async () => {
    await expect(
      assertDataRoomMoveAllowed({
        ...owner,
        fromFolderPath: "Series A",
        toFolderPath: "Archive/Series A",
      }),
    ).resolves.toBeUndefined();
  });

  it("lets an ordinary folder move into a room", async () => {
    await expect(
      assertDataRoomMoveAllowed({
        ...owner,
        fromFolderPath: "Notes",
        toFolderPath: "Series A/Notes",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("rebaseDataRooms", () => {
  it("moves the room and a room under the folder to the new path", async () => {
    db.dataRoom.findMany.mockResolvedValue([
      { id: "r1", folderPath: "Deals" },
      { id: "r2", folderPath: "Deals/Acme" },
    ]);
    await rebaseDataRooms({
      ...owner,
      fromFolderPath: "Deals",
      toFolderPath: "Archive/Deals",
    });
    expect(db.dataRoom.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { folderPath: "Archive/Deals" },
    });
    expect(db.dataRoom.update).toHaveBeenCalledWith({
      where: { id: "r2" },
      data: { folderPath: "Archive/Deals/Acme" },
    });
  });

  it("does nothing for a rename to the same path", async () => {
    await rebaseDataRooms({
      ...owner,
      fromFolderPath: "Deals",
      toFolderPath: "Deals/",
    });
    expect(db.dataRoom.findMany).not.toHaveBeenCalled();
  });
});

describe("deleteDataRoomsUnder", () => {
  it("forgets the rooms on a deleted folder and below it, never a sibling", async () => {
    db.dataRoom.deleteMany.mockResolvedValue({ count: 1 });
    await deleteDataRoomsUnder({ ...owner, folderPath: "Deals" });
    expect(db.dataRoom.deleteMany).toHaveBeenCalledWith({
      where: {
        sourceScope: "ORGANIZATION",
        ownerId: "org_1",
        OR: [{ folderPath: "Deals" }, { folderPath: { startsWith: "Deals/" } }],
      },
    });
  });
});
