import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StagedUploadStorage } from "@/services/file-catalog.service";

const mocks = vi.hoisted(() => ({
  head: vi.fn(),
  promote: vi.fn(),
  etag: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@/lib/drive-blob", () => ({
  driveHead: mocks.head,
  promoteStagedUpload: mocks.promote,
  stagedUploadEtag: mocks.etag,
}));
vi.mock("@/services/file-catalog.service", () => ({
  publishStagedDriveUpload: mocks.publish,
}));

import { publishStagedUpload } from "./drive-staged-upload";

const KEY = {
  workspaceId: "w",
  scope: "user" as const,
  ownerId: "u",
  pathname: "drive/users/u/a.md",
};

async function storage(): Promise<StagedUploadStorage> {
  await publishStagedUpload(KEY, "attempt-1");
  return mocks.publish.mock.calls[0][0].storage;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.promote.mockResolvedValue("moved");
});

/**
 * The storage report the catalog decides on: whether the attempt is still
 * staged and what the pathname holds, read after the move, never inferred
 * from what the move call answered.
 */
describe("staged upload storage report", () => {
  it("reports a move that emptied staging and filled the pathname", async () => {
    mocks.etag.mockResolvedValue(null);
    mocks.head.mockResolvedValue({ size: 3, contentType: "text/markdown" });

    await expect(
      (await storage()).promote("drive-staging/x/a.md"),
    ).resolves.toEqual({
      stillStaged: false,
      stored: { sizeBytes: 3, mimeType: "text/markdown" },
    });
  });

  it("reports staging still full beside another writer's bytes", async () => {
    mocks.promote.mockResolvedValue("occupied");
    mocks.etag.mockResolvedValue('"staged"');
    mocks.head.mockResolvedValue({ size: 9, contentType: "text/plain" });

    await expect(
      (await storage()).promote("drive-staging/x/a.md"),
    ).resolves.toMatchObject({ stillStaged: true, stored: { sizeBytes: 9 } });
  });

  it("propagates a move that failed in flight, so the claim stays", async () => {
    mocks.promote.mockRejectedValue(new Error("network"));

    await expect(
      (await storage()).promote("drive-staging/x/a.md"),
    ).rejects.toThrow("network");
  });
});
