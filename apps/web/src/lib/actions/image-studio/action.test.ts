import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      handler(params),
}));

const getSocialMediaMock = vi.fn();
const writeCaptionMock = vi.fn();
const toCoreApiActionErrorMock = vi.fn();

vi.mock("@/lib/services/image-studio.service", () => ({
  imageStudioService: {
    createJob: vi.fn(),
    cancelJob: vi.fn(),
    getSocialMedia: (...args: unknown[]) => getSocialMediaMock(...args),
    writeCaption: (...args: unknown[]) => writeCaptionMock(...args),
  },
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {},
  toCoreApiActionError: (...args: unknown[]) =>
    toCoreApiActionErrorMock(...args),
}));

import {
  prepareStudioAssetSocialMedia,
  writeStudioAssetCaption,
} from "./action";

const MEDIA = {
  pathname: "drive/users/user-1/Content Studio/fox.png",
  fileUrl: "https://store.public.blob.vercel-storage.com/fox.png",
  name: "fox.png",
  size: 12,
  mimeType: "image/png",
  kind: "image" as const,
};

describe("prepareStudioAssetSocialMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toCoreApiActionErrorMock.mockImplementation((error: unknown) => ({
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Unexpected error",
    }));
  });

  it("returns the Drive file Social can attach", async () => {
    getSocialMediaMock.mockResolvedValue(MEDIA);

    const result = await prepareStudioAssetSocialMedia({
      projectId: "project-1",
      assetId: "asset-1",
    });

    expect(getSocialMediaMock).toHaveBeenCalledWith("project-1", "asset-1");
    expect(result).toEqual({ ok: true, value: MEDIA });
  });

  it("rejects a blank image", async () => {
    const result = await prepareStudioAssetSocialMedia({
      projectId: "  ",
      assetId: "asset-1",
    });

    expect(getSocialMediaMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: { code: "BAD_INPUT", message: "Image required" },
    });
  });

  it("maps a Core failure", async () => {
    getSocialMediaMock.mockRejectedValue(new Error("gone"));

    const result = await prepareStudioAssetSocialMedia({
      projectId: "project-1",
      assetId: "asset-1",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "gone" },
    });
  });
});

describe("writeStudioAssetCaption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toCoreApiActionErrorMock.mockImplementation((error: unknown) => ({
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Unexpected error",
    }));
  });

  it("returns the caption Core wrote", async () => {
    writeCaptionMock.mockResolvedValue({ text: "Late sun on a red fox." });

    const result = await writeStudioAssetCaption({
      projectId: "project-1",
      assetId: "asset-1",
    });

    expect(writeCaptionMock).toHaveBeenCalledWith("project-1", "asset-1");
    expect(result).toEqual({
      ok: true,
      value: { text: "Late sun on a red fox." },
    });
  });

  it("rejects a blank image", async () => {
    const result = await writeStudioAssetCaption({
      projectId: "project-1",
      assetId: "  ",
    });

    expect(writeCaptionMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: { code: "BAD_INPUT", message: "Image required" },
    });
  });

  it("maps a Core failure", async () => {
    writeCaptionMock.mockRejectedValue(new Error("gateway down"));

    const result = await writeStudioAssetCaption({
      projectId: "project-1",
      assetId: "asset-1",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "gateway down" },
    });
  });
});
