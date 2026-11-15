import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  driveStar: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
const search = vi.hoisted(() => ({
  loadLiveResources: vi.fn(),
  hydrateResources: vi.fn(),
}));
vi.mock("@/services/file-search.service", () => search);
const blob = vi.hoisted(() => ({ driveHasAny: vi.fn() }));
vi.mock("@/lib/drive-blob", () => blob);
const rooms = vi.hoisted(() => ({ hiddenDataRoomFolders: vi.fn() }));
vi.mock("@/lib/data-room-visibility", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...rooms,
}));

import {
  deleteDriveFolderStars,
  listDriveStars,
  setDriveStar,
} from "./drive-star.service";

const store = {
  workspaceId: "ws-1",
  scope: "organization" as const,
  ownerId: "org-1",
  actor: {
    userId: "u-1",
    organizationId: "org-1",
    kind: "interactive" as const,
  },
};

beforeEach(() => vi.clearAllMocks());

describe("setDriveStar", () => {
  it("stars a file the person can open", async () => {
    search.loadLiveResources.mockResolvedValue([{ id: "f-1" }]);

    await setDriveStar({
      store,
      target: { kind: "file", resourceId: "f-1" },
      starred: true,
    });

    expect(search.loadLiveResources).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      actor: store.actor,
      resourceIds: ["f-1"],
    });
    expect(db.driveStar.upsert).toHaveBeenCalledWith({
      where: {
        userId_workspaceId_resourceId: {
          userId: "u-1",
          workspaceId: "ws-1",
          resourceId: "f-1",
        },
      },
      create: { userId: "u-1", workspaceId: "ws-1", resourceId: "f-1" },
      update: {},
    });
  });

  it("refuses a file the person cannot open", async () => {
    search.loadLiveResources.mockResolvedValue([]);

    await expect(
      setDriveStar({
        store,
        target: { kind: "file", resourceId: "f-2" },
        starred: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.driveStar.upsert).not.toHaveBeenCalled();
  });

  it("stars a folder by its normalized path", async () => {
    rooms.hiddenDataRoomFolders.mockResolvedValue([]);
    blob.driveHasAny.mockResolvedValue(true);

    await setDriveStar({
      store,
      target: { kind: "folder", folderPath: "/Finance/Q4/" },
      starred: true,
    });

    expect(blob.driveHasAny).toHaveBeenCalledWith(
      "drive/organizations/org-1/Finance/Q4/",
    );
    const where = {
      userId: "u-1",
      workspaceId: "ws-1",
      folderPath: "Finance/Q4",
    };
    expect(db.driveStar.upsert).toHaveBeenCalledWith({
      where: { userId_workspaceId_folderPath: where },
      create: where,
      update: {},
    });
  });

  it("refuses a folder inside a data room the person is not in", async () => {
    rooms.hiddenDataRoomFolders.mockResolvedValue(["Deals"]);
    blob.driveHasAny.mockResolvedValue(true);

    await expect(
      setDriveStar({
        store,
        target: { kind: "folder", folderPath: "Deals/Term sheets" },
        starred: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.driveStar.upsert).not.toHaveBeenCalled();
  });

  it("refuses a folder that does not exist", async () => {
    rooms.hiddenDataRoomFolders.mockResolvedValue([]);
    blob.driveHasAny.mockResolvedValue(false);

    await expect(
      setDriveStar({
        store,
        target: { kind: "folder", folderPath: "Gone" },
        starred: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("unstars a folder without checking it", async () => {
    await setDriveStar({
      store,
      target: { kind: "folder", folderPath: "Gone/" },
      starred: false,
    });

    expect(db.driveStar.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u-1", workspaceId: "ws-1", folderPath: "Gone" },
    });
    expect(blob.driveHasAny).not.toHaveBeenCalled();
  });
});

describe("listDriveStars", () => {
  it("lists only stars the person can still open, newest first", async () => {
    db.driveStar.findMany.mockResolvedValue([
      { resourceId: "f-new", folderPath: null },
      { resourceId: null, folderPath: "Deals/Q4" },
      { resourceId: "f-gone", folderPath: null },
      { resourceId: null, folderPath: "Finance/Board" },
      { resourceId: null, folderPath: "Deleted" },
      { resourceId: "f-old", folderPath: null },
    ]);
    search.loadLiveResources.mockResolvedValue([
      { id: "f-old" },
      { id: "f-new" },
    ]);
    search.hydrateResources.mockImplementation(async ({ resources }) =>
      resources.map((resource: { id: string }) => ({ id: resource.id })),
    );
    rooms.hiddenDataRoomFolders.mockResolvedValue(["Deals"]);
    blob.driveHasAny.mockImplementation(
      async (prefix: string) => !prefix.endsWith("Deleted/"),
    );

    const stars = await listDriveStars(store);

    expect(db.driveStar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u-1", workspaceId: "ws-1" },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(stars).toEqual({
      folders: [{ path: "Finance/Board", name: "Board" }],
      files: [{ id: "f-new" }, { id: "f-old" }],
    });
  });
});

// Rebase runs as SQL; drive-star.postgres.test.ts covers it on PostgreSQL.
describe("folder stars follow the folder", () => {
  it("removes stars on a deleted folder and its subfolders", async () => {
    await deleteDriveFolderStars({ workspaceId: "ws-1", folderPath: "Old/" });

    expect(db.driveStar.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws-1",
        OR: [{ folderPath: "Old" }, { folderPath: { startsWith: "Old/" } }],
      },
    });
  });
});
