import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assetFindFirst: vi.fn(),
  fileFindUnique: vi.fn(),
  readBytes: vi.fn(),
  reserve: vi.fn(),
  activate: vi.fn(),
  put: vi.fn(),
  nudge: vi.fn(),
  taskFindMany: vi.fn(),
  taskUpdate: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageAsset: { findFirst: mocks.assetFindFirst },
    fileResource: { findUnique: mocks.fileFindUnique },
    task: { findMany: mocks.taskFindMany, update: mocks.taskUpdate },
  },
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: mocks.readBytes,
}));
vi.mock("@/services/file-catalog.service", () => ({
  reserveDriveUploadResource: mocks.reserve,
  activateDriveUploadResource: mocks.activate,
}));
vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileIndexing: mocks.nudge,
}));
vi.mock("@vercel/blob", () => ({
  put: mocks.put,
}));

import {
  ensureStudioAssetDriveFile,
  moveLegacyStudioFolderTasks,
  publishStudioAssetToFiles,
  studioAssetFileName,
} from "@/services/image-studio-drive.service";

const INPUT = {
  projectId: "project-1",
  assetId: "asset-7",
  workspaceId: "workspace-1",
  organizationId: "org-1",
  userId: "user-1",
  prompt: "A purple robot logo",
  jobId: "01a0f430-aaaa-7000-8000-000000000001",
};

describe("ensureStudioAssetDriveFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assetFindFirst.mockResolvedValue({
      blobPathname: "studio/asset-7.png",
      contentType: "image/png",
      prompt: INPUT.prompt,
      jobId: INPUT.jobId,
    });
    mocks.readBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.reserve.mockResolvedValue({ resourceId: "file-9", versionId: "v" });
    mocks.activate.mockResolvedValue({ resourceId: "file-9" });
    mocks.put.mockResolvedValue({});
  });

  it("copies the image once into Content Studio", async () => {
    mocks.fileFindUnique.mockResolvedValue(null);

    await expect(ensureStudioAssetDriveFile(INPUT)).resolves.toEqual({
      id: "file-9",
      name: "a-purple-robot-logo-01a0f430.png",
      pathname:
        "drive/organizations/org-1/Content Studio/a-purple-robot-logo-01a0f430.png",
      mimeType: "image/png",
      size: 3,
    });
    expect(mocks.put).toHaveBeenCalledWith(
      "drive/organizations/org-1/Content Studio/a-purple-robot-logo-01a0f430.png",
      expect.any(Buffer),
      expect.objectContaining({ access: "public", addRandomSuffix: false }),
    );
    expect(mocks.nudge).toHaveBeenCalled();
  });

  it("hands back the existing copy instead of writing another", async () => {
    mocks.fileFindUnique.mockResolvedValue({
      id: "file-9",
      lifecycle: "ACTIVE",
      tombstonedAt: null,
      mimeType: "image/png",
      sizeBytes: 3,
    });

    await expect(ensureStudioAssetDriveFile(INPUT)).resolves.toMatchObject({
      id: "file-9",
      pathname:
        "drive/organizations/org-1/Content Studio/a-purple-robot-logo-01a0f430.png",
    });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.readBytes).not.toHaveBeenCalled();
  });

  it("returns nothing when the version is gone", async () => {
    mocks.assetFindFirst.mockResolvedValue(null);
    await expect(ensureStudioAssetDriveFile(INPUT)).resolves.toBeNull();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});

describe("publishStudioAssetToFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activate.mockResolvedValue({ resourceId: "file-9" });
    mocks.put.mockResolvedValue({ url: "https://blob/x.png" });
  });

  it("saves a new image in the Content Studio folder, not a Task", async () => {
    await publishStudioAssetToFiles({
      jobId: INPUT.jobId,
      workspaceId: INPUT.workspaceId,
      organizationId: INPUT.organizationId,
      userId: INPUT.userId,
      prompt: INPUT.prompt,
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    });
    expect(mocks.put.mock.calls[0][0]).toContain(
      "/Content Studio/a-purple-robot-logo-01a0f430.png",
    );
    expect(mocks.reserve.mock.calls[0][0].key).toMatchObject({
      workspaceId: "workspace-1",
      scope: "organization",
      ownerId: "org-1",
    });
  });

  it("never fails settlement when Files is unavailable", async () => {
    mocks.reserve.mockRejectedValue(new Error("down"));
    await expect(
      publishStudioAssetToFiles({
        jobId: INPUT.jobId,
        workspaceId: INPUT.workspaceId,
        organizationId: null,
        userId: INPUT.userId,
        prompt: "x",
        bytes: new Uint8Array([1]),
        contentType: "image/png",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("studioAssetFileName", () => {
  it("slugs the prompt and keeps the job id so names never collide", () => {
    expect(
      studioAssetFileName(
        "A red fox, in the snow!",
        "3f2a9c1d-0000",
        "image/jpeg",
      ),
    ).toBe("a-red-fox-in-the-snow-3f2a9c1d.jpg");
  });

  it("falls back to a plain name and png for an empty prompt or odd type", () => {
    expect(studioAssetFileName("!!!", "abcdef12-0", "image/x-weird")).toBe(
      "image-abcdef12.png",
    );
  });
});

describe("moveLegacyStudioFolderTasks", () => {
  const folderTask = {
    id: "task-1",
    workspaceId: "workspace-1",
    organizationId: "org-1",
    ownerId: "user-1",
    creatorUserId: "user-1",
    files: [
      {
        name: "a-fox-3f2a9c1d.png",
        fileUrl: "https://blob/task/a-fox.png",
        mimeType: "image/png",
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reserve.mockResolvedValue({ resourceId: "file-9", versionId: "v" });
    mocks.activate.mockResolvedValue({ resourceId: "file-9" });
    mocks.put.mockResolvedValue({ url: "https://blob/x.png" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2]))),
    );
  });

  it("copies each file into Content Studio, then archives the Task", async () => {
    mocks.taskFindMany.mockResolvedValueOnce([folderTask]);
    expect(await moveLegacyStudioFolderTasks(5)).toEqual({
      moved: 1,
      failed: 0,
    });
    expect(mocks.put.mock.calls[0][0]).toContain(
      "/Content Studio/a-fox-3f2a9c1d.png",
    );
    expect(mocks.taskUpdate).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it("keeps the Task when a file cannot be copied", async () => {
    mocks.taskFindMany.mockResolvedValueOnce([folderTask]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    expect(await moveLegacyStudioFolderTasks(5)).toEqual({
      moved: 0,
      failed: 1,
    });
    expect(mocks.taskUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { archivedAt: expect.any(Date) } }),
    );
  });

  it("stops looking once no folder Task is left", async () => {
    mocks.taskFindMany.mockResolvedValueOnce([]);
    await moveLegacyStudioFolderTasks(5);
    await moveLegacyStudioFolderTasks(5);
    expect(mocks.taskFindMany).toHaveBeenCalledTimes(1);
  });
});
