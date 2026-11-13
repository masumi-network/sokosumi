import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  assets: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: mocks.workspace },
    projectImageAsset: { findMany: mocks.assets },
  },
}));
vi.mock("@/services/image-studio-events.service", () => ({
  recordStudioAdEvent: mocks.record,
}));
vi.mock("@/services/file-catalog.service", () => ({}));
vi.mock("@/services/image-studio-assets.service", () => ({}));
vi.mock("@/lib/drive-blob", () => ({}));
vi.mock("@/lib/files/in-process-indexer", () => ({}));

import { recordSocialStudioAdEvents } from "./social-studio-events.service";

const pathname =
  "drive/organizations/org-1/Content Studio/a-purple-robot-00000001.png";
const input = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  postId: "post-1",
  userId: "user-1",
  type: "attached_to_post" as const,
  media: [{ pathname }],
};

describe("recordSocialStudioAdEvents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.workspace.mockResolvedValue({
      organizationId: "org-1",
      userId: null,
    });
    mocks.assets.mockResolvedValue([
      {
        id: "asset-1",
        prompt: "A purple robot",
        jobId: "01a0f430-aaaa-7000-8000-000000000001",
        contentType: "image/png",
      },
    ]);
  });

  it("matches a full Drive pathname within the workspace and project", async () => {
    await recordSocialStudioAdEvents(input);
    expect(mocks.assets).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1", projectId: "project-1" },
      select: { id: true, prompt: true, jobId: true, contentType: true },
    });
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "workspace-1",
      assetId: "asset-1",
      userId: "user-1",
      type: "attached_to_post",
      meta: { socialPostId: "post-1" },
    });
  });

  it("does not attribute another owner's identically named file", async () => {
    await recordSocialStudioAdEvents({
      ...input,
      media: [{ pathname: pathname.replace("org-1", "org-2") }],
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("matches the owner of a personal workspace", async () => {
    mocks.workspace.mockResolvedValue({
      organizationId: null,
      userId: "owner",
    });
    await recordSocialStudioAdEvents({
      ...input,
      type: "posted",
      media: [
        { pathname: pathname.replace("organizations/org-1", "users/owner") },
      ],
    });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-1", type: "posted" }),
    );
  });

  it("counts an asset once across the post and its thread parts", async () => {
    await recordSocialStudioAdEvents({
      ...input,
      type: "scheduled",
      threadParts: [{ media: [{ pathname }] }],
    });
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  it("credits the original Studio asset when Social adapts its image", async () => {
    const transformed = {
      pathname: pathname.replace(".png", "-instagram-1234.jpg"),
      transformation: { original: { pathname } },
    };
    await recordSocialStudioAdEvents({
      ...input,
      type: "posted",
      media: [transformed],
    });
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ assetId: "asset-1", type: "posted" }),
    );
    mocks.record.mockClear();
    await recordSocialStudioAdEvents({
      ...input,
      media: [transformed],
      previousMedia: [{ pathname }],
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("ignores unchanged attachments and unrelated Drive files", async () => {
    await recordSocialStudioAdEvents({
      ...input,
      previousMedia: [{ pathname }],
    });
    await recordSocialStudioAdEvents({
      ...input,
      media: [{ pathname: "drive/organizations/org-1/photo.png" }],
    });
    await recordSocialStudioAdEvents({
      ...input,
      previousThreadParts: [{ media: [{ pathname }] }],
    });
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("does not fail a post when pathname lookup or event logging fails", async () => {
    mocks.workspace.mockRejectedValueOnce(new Error("lookup unavailable"));
    await expect(recordSocialStudioAdEvents(input)).resolves.toBeUndefined();
    mocks.record.mockRejectedValueOnce(new Error("event store unavailable"));
    await expect(recordSocialStudioAdEvents(input)).resolves.toBeUndefined();
  });
});
