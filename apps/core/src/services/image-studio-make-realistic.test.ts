import "./image-studio-two-step.fixture";

import { convertCreditsToCents } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import { imageModel } from "@/lib/image-studio/catalog";
import { creditsPerImage } from "@/lib/image-studio/image-model";
import { expectCoreLogWhys } from "@/test/core-log";
import {
  createImageJob,
  failImageJob,
  settleWithMedia,
} from "./image-studio-jobs.service";
import {
  assets,
  INPUT,
  jobs,
  mocks,
  SETTINGS,
  stored,
} from "./image-studio-two-step.fixture";

const vectorId = "recraft-v4-1-text-to-vector";
const route = "make_realistic";
const experimentArm = "router:sonnet-5";
const request = {
  ...INPUT,
  prompt: "Paint two birds above the words Fly High.",
  route,
  experimentArm,
  modelId: "ideogram-v3",
  lettering: "ideogram",
  settings: {
    ...SETTINGS,
    seed: 123,
    outputFormat: "jpeg",
    resolution: "0.5K",
  },
} as const;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>';
const firstUrl = "https://v3.fal.media/layout.svg";

async function settleVector(source = svg) {
  mocks.download.mockResolvedValueOnce({
    bytes: Buffer.from(source),
    contentType: "image/svg+xml",
  });
  await settleWithMedia("job-1", firstUrl);
}

describe("automatic make_realistic rendering", () => {
  it("freezes both quotes and delivers only the final PNG to Files", async () => {
    const vector = imageModel(vectorId);
    const render = imageModel("gemini-pro");
    const first = creditsPerImage(vector, SETTINGS);
    const second = creditsPerImage(render, SETTINGS);
    expect(first + second).toBe(23);
    await createImageJob(request);
    expect(jobs[0]).toMatchObject({
      model: vector.generateEndpoint,
      lettering: "overlay",
      chargedCents: convertCreditsToCents(first),
      letteringQuoteCents: convertCreditsToCents(second),
      settings: {
        ...SETTINGS,
        route,
        experimentArm,
        renderSettings: SETTINGS,
        renderModel: render.editEndpoint,
      },
    });
    expect(mocks.submit.mock.calls[0]?.[0].input.colors).toEqual([
      { r: 100, g: 0, b: 255 },
    ]);
    expect(mocks.submit.mock.calls[0]?.[0].input.prompt).toContain(
      INPUT.exportHeadline,
    );
    expect(mocks.charge).not.toHaveBeenCalled();
    await settleVector();
    const parent = assets[0];
    expect(parent).toMatchObject({
      hiddenAt: expect.any(Date),
      contentType: "image/png",
    });
    expect(stored.get(String(parent?.blobPathname))?.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(mocks.put).toHaveBeenCalledWith(
      "projects/project-1/image-studio/job-1-source.svg",
      Buffer.from(svg),
      expect.objectContaining({ access: "private" }),
    );
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(jobs[1]).toMatchObject({
      kind: "EDIT",
      model: render.editEndpoint,
      prompt: request.prompt,
      parentAssetId: parent?.id,
      referenceAssetIds: [parent?.id],
      chargedCents: convertCreditsToCents(second),
      batchSlotId: "job-1",
      idempotencyKey: "studio-realistic:job-1",
      settings: { ...SETTINGS, route, experimentArm },
    });
    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        bytes: stored.get(String(parent?.blobPathname)),
        contentType: "image/png",
      }),
    );
    const payload = mocks.submit.mock.calls[1]?.[0].input;
    expect(payload.image_urls).toEqual([
      "https://v3.fal.media/delivered-reference.png",
    ]);
    expect(payload.output_format).toBe("png");
    expect(payload.prompt).toContain("Preserve the composition, layout");
    expect(payload.prompt).toContain("Do not add, remove or rewrite text");
    expect(payload.prompt).toContain(request.prompt);
    expect(
      mocks.snapshot.mock.calls.map(([args]) => args.create),
    ).toMatchObject([
      { jobId: "job-1", route, experimentArm },
      { jobId: "job-2", route, experimentArm },
    ]);
    expect(mocks.charge.mock.calls.map(([input]) => input.cents)).toEqual([
      convertCreditsToCents(first),
    ]);
    await settleWithMedia("job-2", "https://v3.fal.media/final.png");
    expect(assets).toHaveLength(2);
    expect(assets[1]).toMatchObject({
      contentType: "image/png",
      parentId: parent?.id,
      version: 2,
    });
    expect(assets[1]?.hiddenAt).toBeFalsy();
    expect(JSON.stringify(assets)).not.toContain("-source.svg");
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        assetId: assets[1]?.id,
        contentType: "image/png",
      }),
    );
    expect(mocks.charge.mock.calls.map(([input]) => input.cents)).toEqual([
      convertCreditsToCents(first),
      convertCreditsToCents(second),
    ]);
    expect(jobs).toHaveLength(2);
  });

  it("starts a text-only vector for a product with image references", async () => {
    await createImageJob({
      ...request,
      product: { id: "mug", name: "Clay mug" },
      prompt: "Feature one product: Clay mug.",
      referenceFileIds: ["product-photo"],
      referenceAssetIds: ["previous-image"],
      referenceLibraryIds: ["style"],
      useProductCutout: true,
    });
    expect(jobs[0]).toMatchObject({
      kind: "GENERATE",
      model: imageModel(vectorId).generateEndpoint,
      referenceAssetIds: [],
      referenceFileIds: [],
      referenceLibraryIds: [],
      useProductCutout: false,
    });
    expect(mocks.submit.mock.calls[0]?.[0].input.prompt).toContain("Clay mug");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("quotes the two 2K legs at 8 and 15 credits", async () => {
    await createImageJob({
      ...request,
      settings: { ...SETTINGS, resolution: "2K" },
    });
    expect(jobs[0]).toMatchObject({
      chargedCents: convertCreditsToCents(8),
      letteringQuoteCents: convertCreditsToCents(15),
      settings: { resolution: "2K", renderSettings: { resolution: "2K" } },
    });
  });

  it("requires the full balance before submission", async () => {
    mocks.getBalance.mockResolvedValue(convertCreditsToCents(22));
    await expect(createImageJob(request)).rejects.toThrow("23");
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.charge).not.toHaveBeenCalled();
  });

  it.each([
    "invalid",
    '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
  ])("stops on an invalid vector", async (source) => {
    await createImageJob(request);
    await settleVector(source);
    expect(jobs).toMatchObject([
      { status: "FAILED", failureReason: "invalid_vector_image" },
    ]);
    expect(assets).toHaveLength(0);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.charge).not.toHaveBeenCalled();
  });

  it.each(["queued", "rejected"])(
    "restores the layout when the render is %s and fails",
    async (outcome) => {
      await createImageJob(request);
      if (outcome === "rejected") {
        expectCoreLogWhys("warn", "The image provider refused a generation", [
          "fal answered the submission with a rejection",
        ]);
        mocks.submit.mockResolvedValueOnce({ kind: "rejected", status: 422 });
      }
      await settleVector();
      if (outcome === "queued") await failImageJob("job-2", "provider_error");
      expect(assets).toMatchObject([
        { hiddenAt: null, contentType: "image/png" },
      ]);
      expect(jobs).toMatchObject([
        { status: "SUCCEEDED" },
        { status: "FAILED" },
      ]);
      expect(mocks.ensureDriveFile).toHaveBeenCalledExactlyOnceWith({
        assetId: assets[0]?.id,
        projectId: INPUT.projectId,
        workspaceId: INPUT.workspaceId,
        organizationId: null,
        userId: INPUT.userId,
      });
      expect(mocks.submit).toHaveBeenCalledTimes(2);
      expect(mocks.charge).toHaveBeenCalledTimes(1);
    },
  );

  it("restores the layout when the provider returns an unusable render", async () => {
    await createImageJob(request);
    await settleVector();
    const png = stored.get(String(assets[0]?.blobPathname))!;
    mocks.download.mockResolvedValueOnce({
      bytes: png.subarray(0, Math.floor(png.length / 2)),
      contentType: "image/png",
    });
    await settleWithMedia("job-2", "https://v3.fal.media/render.png");
    expect(jobs[1]).toMatchObject({
      status: "FAILED",
      failureReason: "provider_error",
    });
    expect(assets).toMatchObject([{ hiddenAt: null }]);
    expect(mocks.charge).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("keeps the fallback when a failure arrives during the render download", async () => {
    await createImageJob(request);
    await settleVector();
    const bytes = stored.get(String(assets[0]?.blobPathname));
    mocks.download.mockImplementationOnce(async () => {
      await failImageJob("job-2", "provider_error");
      return { bytes, contentType: "image/png" };
    });
    await settleWithMedia("job-2", "https://v3.fal.media/render.png");
    expect(jobs[1]?.status).toBe("FAILED");
    expect(assets).toMatchObject([{ hiddenAt: null }]);
    expect(mocks.charge).toHaveBeenCalledTimes(1);
  });

  it("delivers a flat vector route in one job", async () => {
    await createImageJob({
      ...INPUT,
      route: "vector",
      modelId: vectorId,
      exportHeadline: undefined,
    });
    await settleVector();
    expect(jobs).toHaveLength(1);
    expect(assets).toMatchObject([{ contentType: "image/png" }]);
    expect(assets[0]?.hiddenAt).toBeFalsy();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });
});
