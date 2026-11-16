import { convertCreditsToCents } from "@sokosumi/utils";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobFindUnique: vi.fn(),
  jobFindUniqueOrThrow: vi.fn(),
  jobCreate: vi.fn(),
  jobUpdate: vi.fn(),
  jobUpdateMany: vi.fn(),
  jobFindMany: vi.fn(),
  assetFindUnique: vi.fn(),
  assetFindFirst: vi.fn(),
  assetFindMany: vi.fn(),
  assetCreate: vi.fn(),
  getBalance: vi.fn(),
  charge: vi.fn(),
  submit: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  put: vi.fn(),
  readAsset: vi.fn(),
  publish: vi.fn(),
  compose: vi.fn(),
  access: vi.fn(),
  brandKit: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "fixture" }),
  getBetterAuthPublicBaseUrl: () => "http://localhost:8787",
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: mocks.put }));
vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: { getBalance: mocks.getBalance },
}));
vi.mock("@/helpers/task-credits", () => ({
  createTaskEventTransaction: mocks.charge,
  isInsufficientBalanceError: () => false,
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: mocks.access,
  requireProjectAccessForUser: mocks.access,
}));
vi.mock("@/lib/image-studio/reference-files", () => ({
  requireStudioReferenceFiles: async ({
    resourceIds,
  }: {
    resourceIds: string[];
  }) => resourceIds,
}));
vi.mock("@/lib/drive-blob", () => ({
  driveHead: async () => ({
    size: 3,
    access: "public",
    url: "https://fixture.test/product.png",
  }),
  driveReadUrl: vi.fn(),
}));
vi.mock("@/lib/image-studio/product-cutout", () => ({
  validateStudioProductCutout: vi.fn(),
  composeStudioProductCutout: mocks.compose,
}));
vi.mock("@/lib/image-studio/studio-brand", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image-studio/studio-brand")>()),
  loadStudioBrand: async () => ({
    designMd: null,
    memory: null,
    brandBrain: null,
  }),
  readStudioBrandKit: mocks.brandKit,
}));
vi.mock("@/lib/image-studio/fal-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image-studio/fal-client")>()),
  submitToQueue: mocks.submit,
  downloadMedia: mocks.download,
  uploadReference: mocks.upload,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  readAssetBytes: mocks.readAsset,
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  publishStudioAssetToFiles: mocks.publish,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageJob: {
      findUnique: mocks.jobFindUnique,
      findUniqueOrThrow: mocks.jobFindUniqueOrThrow,
      create: mocks.jobCreate,
      update: mocks.jobUpdate,
      updateMany: mocks.jobUpdateMany,
      findMany: mocks.jobFindMany,
      count: async () => 0,
      aggregate: async () => ({
        _sum: { chargedCents: 0n, letteringQuoteCents: 0n },
      }),
    },
    projectImageAsset: {
      findUnique: mocks.assetFindUnique,
      findFirst: mocks.assetFindFirst,
      findMany: mocks.assetFindMany,
      create: mocks.assetCreate,
    },
    brandBrain: {
      findUnique: async () => ({
        body: {
          summary: "Brand",
          voice: {
            tone: "Direct",
            do: [],
            dont: [],
            examples: ["Made for every day."],
          },
          audience: [],
          products: [],
          competitors: [],
          channels: [],
        },
      }),
    },
  },
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: async (run: (tx: unknown) => Promise<unknown>) =>
    run((await import("@/lib/db/prisma")).default),
}));

import {
  getImageCatalog,
  imageModel,
  setResolvedImageCatalog,
} from "@/lib/image-studio/catalog";
import { creditsPerImage } from "@/lib/image-studio/image-model";
import {
  createImageJob,
  failImageJob,
  settleWithMedia,
} from "./image-studio-jobs.service";

const SETTINGS = {
  aspectRatio: "1:1",
  resolution: "1K",
  outputFormat: "png",
  seed: null,
};
const INPUT = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  sessionId: null,
  prompt: "A product ad",
  exportHeadline: "Made for every day.",
  settings: SETTINGS,
  referenceAssetIds: [] as string[],
  parentAssetId: null,
  idempotencyKey: "fixture-lettering",
};

type Row = Record<string, unknown>;
let jobs: Row[];
let assets: Row[];
let stored: Map<string, Uint8Array>;

beforeEach(async () => {
  vi.clearAllMocks();
  jobs = [];
  assets = [];
  stored = new Map();
  mocks.access.mockResolvedValue({
    projectId: INPUT.projectId,
    workspaceId: INPUT.workspaceId,
    organizationId: null,
  });
  mocks.getBalance.mockResolvedValue(convertCreditsToCents(100));
  mocks.charge.mockImplementation(
    async () => `transaction-${mocks.charge.mock.calls.length}`,
  );
  mocks.brandKit.mockResolvedValue({
    colors: ["#6400ff", "#ffffff"],
    fonts: ["Space Grotesk"],
  });
  mocks.jobCreate.mockImplementation(async ({ data }: { data: Row }) => {
    const row = {
      id: `job-${jobs.length + 1}`,
      referenceFileIds: [],
      useProductCutout: false,
      submitAttempts: 0,
      ...data,
    };
    jobs.push(row);
    return row;
  });
  mocks.jobFindUnique.mockImplementation(async ({ where }: { where: Row }) => {
    if (where.projectId_idempotencyKey) return null;
    const job = jobs.find((row) => row.id === where.id);
    return job
      ? { ...job, asset: assets.find((row) => row.jobId === job.id) ?? null }
      : null;
  });
  mocks.jobFindUniqueOrThrow.mockImplementation(
    async ({ where }: { where: Row }) =>
      jobs.find((row) => row.id === where.id),
  );
  mocks.jobUpdate.mockImplementation(
    async ({ where, data }: { where: Row; data: Row }) => {
      const row = jobs.find((job) => job.id === where.id);
      Object.assign(row ?? {}, data);
      return row;
    },
  );
  mocks.jobUpdateMany.mockImplementation(
    async ({ where, data }: { where: Row; data: Row }) => {
      const row = jobs.find((job) => job.id === where.id);
      Object.assign(row ?? {}, data);
      return { count: 1 };
    },
  );
  mocks.jobFindMany.mockResolvedValue([]);
  mocks.assetFindUnique.mockImplementation(
    async ({ where }: { where: Row }) =>
      assets.find((row) => row.jobId === where.jobId) ?? null,
  );
  mocks.assetFindFirst.mockImplementation(async ({ where }: { where: Row }) => {
    const asset = assets.find(
      (row) => row.id === where.id || row.rootId === where.rootId,
    );
    return asset
      ? { ...asset, job: jobs.find((row) => row.id === asset.jobId) }
      : null;
  });
  mocks.assetFindMany.mockImplementation(async () => assets);
  mocks.assetCreate.mockImplementation(async ({ data }: { data: Row }) => {
    assets.push(data);
    return data;
  });
  mocks.put.mockImplementation(async (path: string, bytes: Uint8Array) => {
    stored.set(path, bytes);
    return { pathname: path };
  });
  mocks.readAsset.mockImplementation(async (path: string) => stored.get(path));
  mocks.upload.mockImplementation(async ({ fileName }: { fileName: string }) =>
    String(fileName).includes("mask")
      ? "https://v3.fal.media/headline-mask.png"
      : "https://v3.fal.media/delivered-reference.png",
  );
  mocks.submit.mockResolvedValue({ kind: "queued", requestId: "fal-fixture" });
  const scene = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .png()
    .toBuffer();
  mocks.download.mockResolvedValue({
    bytes: new Uint8Array(scene),
    contentType: "image/png",
  });
  mocks.compose.mockResolvedValue({
    bytes: new Uint8Array([4, 5, 6]),
    contentType: "image/png",
  });
});

describe("optional two-step lettering", () => {
  it("defaults a headlined ad to two-step Ideogram lettering", async () => {
    await createImageJob(INPUT);
    const first = creditsPerImage(imageModel("gemini-pro"), SETTINGS);
    const second = creditsPerImage(imageModel("ideogram-v3"), SETTINGS);
    expect(jobs[0]).toMatchObject({
      lettering: "ideogram",
      model: imageModel("gemini-pro").generateEndpoint,
      letteringQuoteCents: convertCreditsToCents(second),
      chargedCents: convertCreditsToCents(first),
    });
    await settleWithMedia("job-1", "https://v3.fal.media/backdrop.png");
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toMatchObject({
      lettering: "ideogram",
      model: "fal-ai/ideogram/v3/edit",
    });
  });

  it("still buys one generation when overlay is requested explicitly", async () => {
    await createImageJob({ ...INPUT, lettering: "overlay" });
    await settleWithMedia("job-1", "https://v3.fal.media/backdrop.png");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.lettering).toBe("overlay");
    expect(jobs[0]?.letteringQuoteCents).toBeUndefined();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("quotes both catalog legs before submit and charges each only when delivered", async () => {
    await createImageJob({
      ...INPUT,
      lettering: "ideogram",
      batchId: "batch-1",
    });
    const first = creditsPerImage(imageModel("gemini-pro"), SETTINGS);
    const second = creditsPerImage(imageModel("ideogram-v3"), SETTINGS);
    expect(first + second).toBe(18);
    expect(jobs[0]).toMatchObject({
      model: imageModel("gemini-pro").generateEndpoint,
      chargedCents: convertCreditsToCents(first),
      letteringQuoteCents: convertCreditsToCents(second),
    });
    expect(mocks.charge).not.toHaveBeenCalled();
    expect(mocks.submit.mock.calls[0]?.[0].input.prompt).toContain(
      "leave marketing text out",
    );
    expect(mocks.submit.mock.calls[0]?.[0].input.prompt).toContain(
      "Preserve text printed on the product and its packaging",
    );

    await settleWithMedia("job-1", "https://v3.fal.media/backdrop.png");
    expect(assets[0]).not.toHaveProperty("headline");
    expect(jobs[1]).toMatchObject({
      kind: "EDIT",
      model: "fal-ai/ideogram/v3/edit",
      parentAssetId: assets[0]?.id,
      referenceAssetIds: [assets[0]?.id],
      chargedCents: convertCreditsToCents(second),
      batchSlotId: "job-1",
    });
    expect(jobs[1]).not.toHaveProperty("letteringQuoteCents");
    // Campaign exports query original batch jobs, then pick each slot's latest revision.
    expect(jobs.filter((job) => job.batchId === "batch-1")).toHaveLength(1);
    expect(jobs[1]).not.toHaveProperty("batchId");
    const payload = mocks.submit.mock.calls[1]?.[0];
    expect(payload.model).toBe("fal-ai/ideogram/v3/edit");
    expect(payload.input.image_url).toBe(
      "https://v3.fal.media/delivered-reference.png",
    );
    expect(payload.input.mask_url).toBe(
      "https://v3.fal.media/headline-mask.png",
    );
    expect(payload.input).not.toHaveProperty("image_urls");
    expect(payload.input.enable_prompt_expansion).toBe(false);
    expect(payload.input.prompt).toContain(INPUT.exportHeadline);
    expect(payload.input.prompt).toContain("#6400ff");
    expect(payload.input.prompt).toContain("Space Grotesk");
    expect(payload.input.prompt).not.toContain(
      "Studio adds the approved headline",
    );
    expect(payload.input.prompt).not.toContain("leave marketing text out");

    await settleWithMedia("job-2", "https://v3.fal.media/lettered.png");
    expect(mocks.charge.mock.calls.map(([input]) => input.cents)).toEqual([
      convertCreditsToCents(first),
      convertCreditsToCents(second),
    ]);
    expect(jobs).toHaveLength(2);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("refuses the first paid call when the balance covers only the backdrop", async () => {
    mocks.getBalance.mockResolvedValue(convertCreditsToCents(17));
    await expect(
      createImageJob({ ...INPUT, lettering: "ideogram" }),
    ).rejects.toThrow("18");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("never enqueues lettering after a first-step failure", async () => {
    await createImageJob({ ...INPUT, lettering: "ideogram" });
    await failImageJob("job-1", "provider_error");
    await settleWithMedia("job-1", "https://v3.fal.media/no-result.png");
    expect(jobs).toHaveLength(1);
    expect(assets).toHaveLength(0);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.charge).not.toHaveBeenCalled();
  });

  it("delivers the backdrop even if Ideogram leaves the catalog between steps", async () => {
    await createImageJob({ ...INPUT, lettering: "ideogram" });
    const catalog = getImageCatalog();
    setResolvedImageCatalog(
      catalog.models.filter((model) => model.id !== "ideogram-v3"),
      "2026-11-16T12:00:00Z",
    );
    try {
      await settleWithMedia("job-1", "https://v3.fal.media/backdrop.png");
      expect(assets).toHaveLength(1);
      expect(jobs[0]?.status).toBe("SUCCEEDED");
      expect(jobs[1]).toMatchObject({
        model: "fal-ai/ideogram/v3/edit",
        status: "FAILED",
        failureReason: "request_not_supported",
      });
      expect(mocks.charge).toHaveBeenCalledTimes(1);
      expect(mocks.submit).toHaveBeenCalledTimes(1);
    } finally {
      setResolvedImageCatalog(
        catalog.models,
        catalog.refreshedAt ?? "2026-11-16T11:00:00Z",
      );
    }
  });

  it("keeps the delivered backdrop and its charge when lettering fails", async () => {
    await createImageJob({ ...INPUT, lettering: "ideogram" });
    await settleWithMedia("job-1", "https://v3.fal.media/backdrop.png");
    await failImageJob("job-2", "provider_error");
    expect(assets).toHaveLength(1);
    expect(jobs[1]?.status).toBe("FAILED");
    expect(jobs[0]?.lettering).toBe("ideogram");
    expect(jobs[1]?.parentAssetId).toBe(assets[0]?.id);
    expect(mocks.charge).toHaveBeenCalledTimes(1);
  });

  it("letters the delivered composite when the original product cutout is enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([7, 8, 9]), {
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    try {
      await createImageJob({
        ...INPUT,
        lettering: "ideogram",
        useProductCutout: true,
        referenceFileIds: ["photo-1"],
        referenceFileActor: {
          kind: "interactive",
          userId: "user-1",
          organizationId: null,
        },
      });
      await settleWithMedia("job-1", "https://v3.fal.media/backdrop.png");
      expect(mocks.compose).toHaveBeenCalledTimes(1);
      expect(mocks.upload).toHaveBeenCalledWith(
        expect.objectContaining({ bytes: new Uint8Array([4, 5, 6]) }),
      );
      expect(jobs[1]?.useProductCutout).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retries lettering against the delivered product composite without inheriting a cutout pass", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([7, 8, 9]), {
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    try {
      await createImageJob({
        ...INPUT,
        lettering: "ideogram",
        useProductCutout: true,
        referenceFileIds: ["photo-1"],
        referenceFileActor: {
          kind: "interactive",
          userId: "user-1",
          organizationId: null,
        },
      });
      await settleWithMedia("job-1", "https://v3.fal.media/backdrop.png");
      await failImageJob("job-2", "provider_error");
      const backdropId = String(assets[0]?.id);
      await createImageJob({
        ...INPUT,
        modelId: "ideogram-v3",
        lettering: "ideogram",
        idempotencyKey: "fixture-lettering-retry",
        parentAssetId: backdropId,
        referenceAssetIds: [backdropId],
        reuseParentCutout: true,
        referenceFileActor: {
          kind: "interactive",
          userId: "user-1",
          organizationId: null,
        },
      });
      expect(jobs[2]?.useProductCutout).not.toBe(true);
      expect(jobs[2]?.referenceFileIds).toEqual([]);
      expect(jobs[2]?.letteringQuoteCents).toBeUndefined();
      expect(mocks.upload).toHaveBeenCalledWith(
        expect.objectContaining({ bytes: new Uint8Array([4, 5, 6]) }),
      );
      expect(mocks.upload).toHaveBeenLastCalledWith(
        expect.objectContaining({ fileName: "headline-mask.png" }),
      );
      await settleWithMedia("job-3", "https://v3.fal.media/lettered.png");
      expect(mocks.compose).toHaveBeenCalledTimes(1);
      expect(jobs).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("persists the child before submission so provider failure cannot drop step two", async () => {
    await createImageJob({ ...INPUT, lettering: "ideogram" });
    mocks.submit.mockImplementationOnce(async () => {
      expect(assets).toHaveLength(1);
      expect(jobs[0]?.status).toBe("SUCCEEDED");
      expect(jobs[1]?.idempotencyKey).toBe("studio-lettering:job-1");
      throw new Error("process interrupted after durable enqueue");
    });
    await expect(
      settleWithMedia("job-1", "https://v3.fal.media/backdrop.png"),
    ).rejects.toThrow("process interrupted");
    expect(jobs).toHaveLength(2);
    expect(jobs[1]?.submitAttempts).toEqual({ increment: 1 });
  });
});
