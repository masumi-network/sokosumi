import { convertCreditsToCents } from "@sokosumi/utils";
import sharp from "sharp";
import { beforeEach, vi } from "vitest";

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
  assetUpdateManyAndReturn: vi.fn(),
  snapshot: vi.fn(),
  getBalance: vi.fn(),
  charge: vi.fn(),
  submit: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  put: vi.fn(),
  readAsset: vi.fn(),
  publish: vi.fn(),
  ensureDriveFile: vi.fn(),
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
    designColors: ["#6400ff"],
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
  ensureStudioAssetDriveFile: mocks.ensureDriveFile,
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
      updateManyAndReturn: mocks.assetUpdateManyAndReturn,
    },
    projectImagePromptSnapshot: { upsert: mocks.snapshot },
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

import { pngBytes } from "@/test/image-bytes";

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
// What the compositor hands back: a real PNG, so the stored version has a size.
const COMPOSITE_BYTES = pngBytes(1024, 1024);

beforeEach(async () => {
  vi.clearAllMocks();
  jobs = [];
  assets = [];
  stored = new Map();
  mocks.access.mockResolvedValue({
    projectId: INPUT.projectId,
    workspaceId: INPUT.workspaceId,
    organizationId: null,
    userId: INPUT.userId,
  });
  mocks.ensureDriveFile.mockResolvedValue({ id: "restored-file" });
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
  mocks.assetUpdateManyAndReturn.mockImplementation(
    async ({ where, data }: { where: Row; data: Row }) => {
      const asset = assets.find((row) => row.id === where.id);
      if (!asset?.hiddenAt) return [];
      Object.assign(asset, data);
      return [{ ...asset, job: jobs.find((job) => job.id === asset.jobId) }];
    },
  );
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
    bytes: COMPOSITE_BYTES,
    contentType: "image/png",
  });
});

export { assets, COMPOSITE_BYTES, INPUT, jobs, mocks, SETTINGS, stored };
