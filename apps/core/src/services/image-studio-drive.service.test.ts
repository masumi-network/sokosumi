import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assetFindFirst: vi.fn(),
  fileFindUnique: vi.fn(),
  readBytes: vi.fn(),
  reserve: vi.fn(),
  activate: vi.fn(),
  put: vi.fn(),
  nudge: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageAsset: { findFirst: mocks.assetFindFirst },
    fileResource: { findUnique: mocks.fileFindUnique },
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

import { ensureStudioAssetDriveFile } from "@/services/image-studio-drive.service";

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
