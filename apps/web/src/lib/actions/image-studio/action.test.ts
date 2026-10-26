import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.request";

import {
  prepareStudioAssetSocialMedia,
  startImageGeneration,
  writeStudioAssetCaption,
} from "./action";

const {
  createJob,
  getSocialMediaMock,
  toCoreApiActionErrorMock,
  writeCaptionMock,
} = vi.hoisted(() => ({
  createJob: vi.fn(),
  getSocialMediaMock: vi.fn(),
  toCoreApiActionErrorMock: vi.fn(),
  writeCaptionMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      handler(params),
}));

vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await import("@/lib/clients/core.request");
  return {
    CoreApiRequestError,
    toCoreApiActionError: toCoreApiActionErrorMock,
  };
});

vi.mock("@/lib/services/image-studio.service", () => ({
  imageStudioService: {
    createJob,
    cancelJob: vi.fn(),
    getSocialMedia: getSocialMediaMock,
    writeCaption: writeCaptionMock,
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
});

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

const REQUEST = {
  projectId: "project-1",
  modelId: "model-a",
  prompt: "A calm product photo",
  settings: { aspectRatio: "1:1", resolution: "1K", outputFormat: "png" },
  parentAssetId: "asset-1",
  referenceAssetIds: ["asset-1"],
  sessionId: null,
  idempotencyKey: "ui:request-1",
} satisfies Parameters<typeof startImageGeneration>[0];

describe("starting image generation", () => {
  it("preserves the request identity and returns the accepted job", async () => {
    const job = { id: "job-1" };
    createJob.mockResolvedValue(job);

    const result = await startImageGeneration(REQUEST);

    expect(result).toEqual({ ok: true, job });
    expect(createJob).toHaveBeenCalledWith("project-1", {
      modelId: "model-a",
      prompt: REQUEST.prompt,
      settings: REQUEST.settings,
      parentAssetId: "asset-1",
      referenceAssetIds: ["asset-1"],
      sessionId: null,
      idempotencyKey: "ui:request-1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1/studio");
  });

  it("reports a lost Core response as uncertain even when returned as data", async () => {
    createJob.mockRejectedValue(new CoreApiRequestError("Connection lost"));

    const result = await startImageGeneration(REQUEST);

    expect(result).toEqual({
      ok: false,
      kind: null,
      message: "Connection lost",
      uncertain: true,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([500, 502, 503, 504])(
    "keeps HTTP %i outcomes uncertain so retry can find an accepted job",
    async (status) => {
      createJob.mockRejectedValue(
        new CoreApiRequestError("Core could not finish the response", {
          status,
          kind: "internal_server_error",
        }),
      );

      const result = await startImageGeneration(REQUEST);

      expect(result).toEqual({
        ok: false,
        kind: "internal_server_error",
        message: "Core could not finish the response",
        uncertain: true,
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each([400, 401, 403, 404, 409, 422, 429])(
    "reports HTTP %i as a definitive rejection that can be edited",
    async (status) => {
      createJob.mockRejectedValue(
        new CoreApiRequestError("Choose different settings", {
          status,
          kind: "image_studio_unsupported_model_settings",
        }),
      );

      const result = await startImageGeneration(REQUEST);

      expect(result).toEqual({
        ok: false,
        kind: "image_studio_unsupported_model_settings",
        message: "Choose different settings",
        uncertain: false,
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("leaves unexpected failures to the queue's uncertain recovery path", async () => {
    const error = new Error("Server action connection lost");
    createJob.mockRejectedValue(error);

    await expect(startImageGeneration(REQUEST)).rejects.toBe(error);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not describe a failed revalidation as a rejected generation", async () => {
    createJob.mockResolvedValue({ id: "job-1" });
    const error = new Error("Revalidation failed after acceptance");
    vi.mocked(revalidatePath).mockImplementation(() => {
      throw error;
    });

    await expect(startImageGeneration(REQUEST)).rejects.toBe(error);
    expect(createJob).toHaveBeenCalledTimes(1);
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
