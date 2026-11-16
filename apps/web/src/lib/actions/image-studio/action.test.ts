import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.request";

import {
  getStudioComparePair,
  getStudioModelScoreboard,
  prepareStudioAssetSocialMedia,
  saveStudioPairwisePick,
  startImageGeneration,
  writeStudioAssetCaption,
} from "./action";

const {
  createJob,
  getComparePairMock,
  getModelScoreboardMock,
  getSocialMediaMock,
  toCoreApiActionErrorMock,
  savePairwisePickMock,
  writeCaptionMock,
} = vi.hoisted(() => ({
  createJob: vi.fn(),
  getComparePairMock: vi.fn(),
  getModelScoreboardMock: vi.fn(),
  getSocialMediaMock: vi.fn(),
  toCoreApiActionErrorMock: vi.fn(),
  savePairwisePickMock: vi.fn(),
  writeCaptionMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

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
    getComparePair: getComparePairMock,
    getModelScoreboard: getModelScoreboardMock,
    savePairwisePick: savePairwisePickMock,
    cancelJob: vi.fn(),
    getSocialMedia: getSocialMediaMock,
    writeCaption: writeCaptionMock,
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Studio pairwise actions", () => {
  it("returns the next pair, including the exhausted state", async () => {
    getComparePairMock.mockResolvedValue({ pair: null });

    await expect(
      getStudioComparePair({ projectId: "project-1", batchId: "batch-1" }),
    ).resolves.toEqual({ ok: true, value: { pair: null } });
    expect(getComparePairMock).toHaveBeenCalledWith("project-1", "batch-1");
  });

  it.each(["A", "B", "TIE", "BOTH_BAD"] as const)(
    "forwards the displayed %s choice for Core to canonicalize",
    async (outcome) => {
      const pick = { assetId: "asset-b", otherAssetId: "asset-a", outcome };
      savePairwisePickMock.mockResolvedValue({ id: "pick-1", ...pick });

      await expect(
        saveStudioPairwisePick({
          projectId: "project-1",
          batchId: "batch-1",
          ...pick,
        }),
      ).resolves.toEqual({ ok: true, value: { id: "pick-1", ...pick } });
      expect(savePairwisePickMock).toHaveBeenCalledWith(
        "project-1",
        "batch-1",
        pick,
      );
    },
  );

  it("returns the project scoreboard without changing its scores", async () => {
    const scoreboard = { models: [], minimumComparisons: 10 };
    getModelScoreboardMock.mockResolvedValue(scoreboard);

    await expect(
      getStudioModelScoreboard({ projectId: "project-1" }),
    ).resolves.toEqual({ ok: true, value: scoreboard });
    expect(getModelScoreboardMock).toHaveBeenCalledWith("project-1");
  });

  it.each(["pair", "pick", "scoreboard"])(
    "returns a recoverable Core error for the %s action",
    async (operation) => {
      const failure = new Error("No project access");
      const mapped = { code: "FORBIDDEN", message: "No project access" };
      toCoreApiActionErrorMock.mockReturnValue(mapped);
      getComparePairMock.mockRejectedValue(failure);
      savePairwisePickMock.mockRejectedValue(failure);
      getModelScoreboardMock.mockRejectedValue(failure);

      const input = { projectId: "project-1", batchId: "batch-1" };
      const result =
        operation === "pair"
          ? await getStudioComparePair(input)
          : operation === "scoreboard"
            ? await getStudioModelScoreboard(input)
            : await saveStudioPairwisePick({
                ...input,
                assetId: "asset-a",
                otherAssetId: "asset-b",
                outcome: "TIE",
              });
      expect(result).toEqual({ ok: false, error: mapped });
    },
  );
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
  it("forwards prompt metadata including the first variation", async () => {
    createJob.mockResolvedValue({ id: "job-1" });

    await startImageGeneration({
      ...REQUEST,
      templateId: "social-post",
      creativeDirection: "lifestyle",
      variationIndex: 0,
    });

    expect(createJob).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        templateId: "social-post",
        creativeDirection: "lifestyle",
        variationIndex: 0,
      }),
    );
  });

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
    },
  );

  it("leaves unexpected failures to the queue's uncertain recovery path", async () => {
    const error = new Error("Server action connection lost");
    createJob.mockRejectedValue(error);

    await expect(startImageGeneration(REQUEST)).rejects.toBe(error);
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
