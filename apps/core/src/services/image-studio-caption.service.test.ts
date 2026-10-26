import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  generateText: vi.fn(),
  modelRequest: vi.fn(() => ({ model: "caption-model" })),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageAsset: { findFirst: mocks.findFirst },
  },
}));
vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));
vi.mock("@/lib/soko-bot/model-policy", () => ({
  sokoBotModelRequest: mocks.modelRequest,
}));

import { writeStudioAssetCaption } from "./image-studio-caption.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({ prompt: "a red fox in late sun" });
  mocks.generateText.mockResolvedValue({
    text: "Late sun on a red fox. Square crop, ready to post.",
  });
});

describe("writeStudioAssetCaption", () => {
  it("writes a caption from the stored prompt", async () => {
    const caption = await writeStudioAssetCaption({
      projectId: "project-1",
      assetId: "asset-1",
    });

    expect(caption).toEqual(
      ok("Late sun on a red fox. Square crop, ready to post."),
    );
    expect(mocks.modelRequest).toHaveBeenCalledExactlyOnceWith({
      role: "agent",
      model: "anthropic/claude-haiku-4.5",
    });
    expect(mocks.generateText).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        model: "caption-model",
        prompt: "a red fox in late sun",
      }),
    );
  });

  it("returns missing when the image is gone", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(
      writeStudioAssetCaption({
        projectId: "project-1",
        assetId: "asset-1",
      }),
    ).resolves.toEqual(err("missing"));
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("caps generated captions at 500 characters", async () => {
    mocks.generateText.mockResolvedValue({ text: "x".repeat(501) });

    await expect(
      writeStudioAssetCaption({ projectId: "project-1", assetId: "asset-1" }),
    ).resolves.toEqual(ok("x".repeat(500)));
  });

  it("strips wrapping quotes and treats a blank as empty", async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: '"  A fox at dusk.  "',
    });
    await expect(
      writeStudioAssetCaption({
        projectId: "project-1",
        assetId: "asset-1",
      }),
    ).resolves.toEqual(ok("A fox at dusk."));

    mocks.generateText.mockResolvedValueOnce({ text: "   " });
    await expect(
      writeStudioAssetCaption({
        projectId: "project-1",
        assetId: "asset-1",
      }),
    ).resolves.toEqual(err("empty"));
  });
});
