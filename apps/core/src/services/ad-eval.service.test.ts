import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  waitUntil: vi.fn(),
  asset: vi.fn(),
  reserve: vi.fn(),
  readBytes: vi.fn(),
  reference: vi.fn(),
  judge: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({ waitUntil: mocks.waitUntil }));
vi.mock("@/config/env", () => ({ getEnv: mocks.env }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageAsset: { findUnique: mocks.asset },
    adEval: { update: mocks.update },
  },
}));
vi.mock("@/lib/image-studio/ad-eval-budget", () => ({
  reserveAdEval: mocks.reserve,
  finalizeAdEval: mocks.update,
}));
vi.mock("@/lib/image-studio/ad-eval-judge", () => ({
  AD_EVAL_RUBRIC_VERSION: "test-rubric",
  judgeAdImage: mocks.judge,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: mocks.readBytes,
}));
vi.mock("@/services/image-studio-jobs.service", () => ({
  downloadStudioFileReference: mocks.reference,
}));

import { enqueueAdEval } from "./ad-eval.service";

const ENV = {
  AD_EVALS_ENABLED: true,
  AD_EVALS_PAUSED: false,
  AI_GATEWAY_API_KEY: "test-only-key",
  AD_EVALS_WORKSPACE_DAILY_LIMIT: 100,
  AD_EVALS_GLOBAL_DAILY_USD: 10,
};
const ASSET = {
  id: "asset-1",
  workspaceId: "workspace-1",
  mediaType: "IMAGE",
  model: "meta/muse-image/text-to-image",
  blobPathname: "private/artwork.png",
  prompt: "A red ad with Make it count",
  settings: { aspectRatio: "1:1" },
  workspace: { organizationId: null },
  job: {
    requestedByUserId: "user-1",
    idempotencyKey: "studio:job-1",
    referenceFileIds: [] as string[],
    exportHeadline: "Make it count",
    useProductCutout: false,
    promptSnapshot: {
      finalPrompt:
        "Follow this project's brand.\n\nApproved ad copy (use where relevant):\nMake it count\n\nBrief:\nA red ad with Make it count",
      brandLook: { colors: ["#ff0000"], fonts: ["Inter"] },
    },
  },
};
const VERDICT = {
  judge: {
    overall: 4,
    observations: {
      text: ["Make it count"],
      garbledText: false,
      safe: true,
      logoPresent: null,
    },
  },
  rawJson: { overall: 4, issues: [] },
  judgeModel: "test-vision",
  costUsdMicros: 3_000n,
  latencyMs: 42,
};

async function finishBackground() {
  await Promise.all(mocks.waitUntil.mock.calls.map(([work]) => work));
}

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue(ENV);
  mocks.asset.mockResolvedValue(ASSET);
  mocks.reserve.mockResolvedValue("eval-1");
  mocks.judge.mockResolvedValue(VERDICT);
  mocks.update.mockResolvedValue({});
  const bytes = await sharp({
    create: { width: 1080, height: 1080, channels: 4, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  mocks.readBytes.mockResolvedValue(bytes);
  mocks.reference.mockResolvedValue({ bytes, mimeType: "image/png" });
});

describe("background ad evaluations", () => {
  it.each([
    { ...ENV, AD_EVALS_ENABLED: false },
    { ...ENV, AD_EVALS_PAUSED: true },
  ])("registers no background work when disabled or paused", (env) => {
    mocks.env.mockReturnValue(env);
    enqueueAdEval("job-1");
    expect(mocks.waitUntil).not.toHaveBeenCalled();
    expect(mocks.asset).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...ASSET, mediaType: "VIDEO" },
    { ...ASSET, model: "not-curated" },
    { ...ASSET, job: { ...ASSET.job, promptSnapshot: null } },
  ])("silently skips ineligible assets", async (asset) => {
    mocks.asset.mockResolvedValue(asset);
    enqueueAdEval("job-1");
    await finishBackground();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.judge).not.toHaveBeenCalled();
  });

  it("skips without a gateway key", async () => {
    mocks.env.mockReturnValue({ ...ENV, AI_GATEWAY_API_KEY: undefined });
    enqueueAdEval("job-1");
    await finishBackground();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("skips a cap or duplicate refusal before reading images or calling the judge", async () => {
    mocks.reserve.mockResolvedValue(null);
    enqueueAdEval("job-1");
    await finishBackground();
    expect(mocks.readBytes).not.toHaveBeenCalled();
    expect(mocks.judge).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns immediately while a judge is pending, then stores checks, JSON, cost and latency", async () => {
    let resolveJudge: (value: typeof VERDICT) => void = () => {};
    mocks.judge.mockReturnValue(
      new Promise((resolve) => {
        resolveJudge = resolve;
      }),
    );
    expect(enqueueAdEval("job-1")).toBeUndefined();
    expect(mocks.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    await vi.waitFor(() => expect(mocks.judge).toHaveBeenCalledOnce());
    expect(mocks.update).not.toHaveBeenCalled();
    resolveJudge(VERDICT);
    await finishBackground();
    expect(mocks.reserve).toHaveBeenCalledWith({
      assetId: "asset-1",
      workspaceId: "workspace-1",
      rubricVersion: "test-rubric",
      workspaceDailyLimit: 100,
      globalDailyUsd: 10,
    });
    expect(mocks.judge).toHaveBeenCalledWith(
      expect.objectContaining({
        finalPrompt: ASSET.job.promptSnapshot.finalPrompt,
        brandLook: ASSET.job.promptSnapshot.brandLook,
        headline: "Make it count",
        approvedLines: ["Make it count"],
        image: expect.any(Uint8Array),
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      id: "eval-1",
      checks: expect.arrayContaining([
        { id: "aspect_ok", pass: true, value: 0 },
        { id: "size_ok", pass: true, value: 1080 },
        { id: "text_match", pass: true, value: 1 },
        { id: "logo_present", pass: null, value: null },
      ]),
      judge: VERDICT.rawJson,
      judgeModel: "test-vision",
      overall: 4,
      costUsdMicros: 3_000n,
      latencyMs: 42,
    });
  });

  it("uses the existing authorized Files reader for the product reference", async () => {
    mocks.asset.mockResolvedValue({
      ...ASSET,
      job: { ...ASSET.job, referenceFileIds: ["product-photo"] },
    });
    enqueueAdEval("job-1");
    await finishBackground();
    expect(mocks.reference).toHaveBeenCalledWith(
      "workspace-1",
      "product-photo",
      {
        userId: "user-1",
        organizationId: null,
        kind: "interactive",
      },
    );
    expect(mocks.judge).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImage: expect.any(Uint8Array) }),
    );
  });

  it("evaluates curated edit endpoints", async () => {
    mocks.asset.mockResolvedValue({ ...ASSET, model: "meta/muse-image/edit" });
    enqueueAdEval("job-1");
    await finishBackground();
    expect(mocks.judge).toHaveBeenCalledOnce();
  });

  it("skips OCR matching for headlines added later at export", async () => {
    mocks.asset.mockResolvedValue({
      ...ASSET,
      job: {
        ...ASSET.job,
        promptSnapshot: {
          ...ASSET.job.promptSnapshot,
          finalPrompt:
            "Studio adds the approved headline after generation. Keep the upper area clear for the headline and leave marketing text out of the artwork. Preserve text printed on the product and its packaging.",
        },
      },
    });
    mocks.judge.mockResolvedValue({
      ...VERDICT,
      judge: {
        ...VERDICT.judge,
        observations: { ...VERDICT.judge.observations, text: [] },
      },
    });
    enqueueAdEval("job-1");
    await finishBackground();
    expect(mocks.update.mock.calls[0][0].checks).toContainEqual({
      id: "text_match",
      pass: null,
      value: null,
    });
  });

  it("checks a logo only when the brief asks for one", async () => {
    mocks.asset.mockResolvedValue({
      ...ASSET,
      prompt: "Add our logo above the product",
    });
    mocks.judge.mockResolvedValue({
      ...VERDICT,
      judge: {
        ...VERDICT.judge,
        observations: { ...VERDICT.judge.observations, logoPresent: true },
      },
    });
    enqueueAdEval("job-1");
    await finishBackground();
    expect(mocks.judge).toHaveBeenCalledWith(
      expect.objectContaining({ logoRequested: true }),
    );
    expect(mocks.update.mock.calls[0][0].checks).toContainEqual({
      id: "logo_present",
      pass: true,
      value: true,
    });
  });

  it("keeps automated jobs under their restricted Files actor", async () => {
    mocks.asset.mockResolvedValue({
      ...ASSET,
      job: {
        ...ASSET.job,
        idempotencyKey: "cmo-media:job-1",
        referenceFileIds: ["product-photo"],
      },
    });
    enqueueAdEval("job-1");
    await finishBackground();
    expect(mocks.reference).toHaveBeenCalledWith(
      "workspace-1",
      "product-photo",
      expect.objectContaining({ kind: "soko_bot" }),
    );
  });

  it("rechecks the kill switch before spending", async () => {
    mocks.readBytes.mockImplementation(async () => {
      mocks.env.mockReturnValue({ ...ENV, AD_EVALS_PAUSED: true });
      return sharp({
        create: { width: 1, height: 1, channels: 3, background: "#ff0000" },
      })
        .png()
        .toBuffer();
    });
    enqueueAdEval("job-1");
    await finishBackground();
    expect(mocks.judge).not.toHaveBeenCalled();
  });

  it("retains the conservative reservation when cost is unknown", async () => {
    mocks.judge.mockResolvedValue({ ...VERDICT, costUsdMicros: null });
    enqueueAdEval("job-1");
    await finishBackground();
    expect(mocks.update.mock.calls[0][0].costUsdMicros).toBeNull();
  });

  it.each(["reserve", "readBytes", "judge", "update"] as const)(
    "contains %s failures without rejecting background work",
    async (failingStep) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mocks[failingStep].mockRejectedValue(new Error("test failure"));
      expect(() => enqueueAdEval("job-1")).not.toThrow();
      await expect(finishBackground()).resolves.toBeUndefined();
      vi.restoreAllMocks();
    },
  );

  it("contains a background registration failure", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.reserve.mockResolvedValue(null);
    mocks.waitUntil.mockImplementation(() => {
      throw new Error("registration unavailable");
    });
    expect(() => enqueueAdEval("job-1")).not.toThrow();
    await finishBackground();
    expect(warning).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
