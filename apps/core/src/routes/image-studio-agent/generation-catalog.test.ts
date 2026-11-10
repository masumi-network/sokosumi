import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, createJob, listAssets, listJobs, getJob, getAsset } =
  vi.hoisted(() => ({
    authorize: vi.fn(),
    createJob: vi.fn(),
    listAssets: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    getAsset: vi.fn(),
  }));
vi.mock("./authorize", () => ({ authorizeAgentGrant: authorize }));
const { readCatalog, copyPhoto, findJob } = vi.hoisted(() => ({
  readCatalog: vi.fn(),
  copyPhoto: vi.fn(),
  findJob: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { projectImageJob: { findUnique: findJob } },
}));
vi.mock("@/services/studio-product-catalog.service", () => ({
  readStudioProductCatalog: readCatalog,
  copyRemoteStudioProductPhoto: copyPhoto,
}));
vi.mock("@/services/image-studio-jobs.service", () => ({
  createImageJob: createJob,
  DEFAULT_SETTINGS: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
  reconcileProjectJobs: vi.fn(),
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  listAssets,
  listJobs,
  getJob,
  getAsset,
}));
vi.mock("@/services/image-studio-sessions.service", () => ({
  authorizeAgentSession: vi.fn(),
}));
// The route asks for a fresh catalog before answering. That reaches Redis and the
// environment, neither of which this test is about; the committed snapshot is
// what it asserts against either way.
vi.mock("@/lib/image-studio/fal-catalog-refresh", () => ({
  ensureImageCatalogFresh: vi.fn().mockResolvedValue(undefined),
}));

import { getImageCatalog } from "@/lib/image-studio/catalog";
import app from "./index";

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({
    userId: "user",
    projectId: "project",
    workspaceId: "workspace",
    organizationId: "org",
  });
  findJob.mockResolvedValue(null);
});

describe("agent catalog and generation HTTP contract", () => {
  const productId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const sourceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const selectedProduct = {
    id: productId,
    name: "Clay mug",
    description: "Glazed stoneware",
    price: "EUR 19",
  };

  function swapProduct(catalogProductId = productId) {
    return app.request("/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Switch the product and keep the layout",
        modelId: "flux-2-pro",
        idempotencyKey: "valid-key",
        parentAssetId: sourceId,
        referenceAssetIds: [sourceId],
        catalogProductId,
      }),
    });
  }

  it("resolves a saved replacement product and its uploaded photo in the granted project", async () => {
    readCatalog.mockResolvedValueOnce({
      products: [
        { ...selectedProduct, photo: { id: fileId, name: "mug.png" } },
      ],
    });
    createJob.mockResolvedValueOnce({ id: "new-job", status: "QUEUED" });

    const response = await swapProduct();

    expect(response.status).toBe(200);
    expect(readCatalog).toHaveBeenCalledWith("project");
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        product: { id: productId, name: "Clay mug" },
        parentAssetId: sourceId,
        referenceAssetIds: [sourceId],
        referenceFileIds: [fileId],
        reuseParentPhotoIfAvailable: false,
        reuseParentHeadlineIfAvailable: false,
        referenceFileActor: {
          kind: "interactive",
          userId: "user",
          organizationId: "org",
        },
        prompt:
          "Switch the product and keep the layout\n\nFeature one product: Clay mug.\nGlazed stoneware\nApproved price: EUR 19.",
      }),
    );
    expect(copyPhoto).not.toHaveBeenCalled();
  });

  it("allows a regular edit to reuse the original product photo", async () => {
    createJob.mockResolvedValueOnce({ id: "new-job", status: "QUEUED" });

    const response = await app.request("/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Change the headline",
        modelId: "flux-2-pro",
        idempotencyKey: "valid-key",
        parentAssetId: sourceId,
        referenceAssetIds: [sourceId],
      }),
    });

    expect(response.status).toBe(200);
    expect(readCatalog).not.toHaveBeenCalled();
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        parentAssetId: sourceId,
        referenceAssetIds: [sourceId],
        reuseParentPhotoIfAvailable: true,
        reuseParentHeadlineIfAvailable: true,
        referenceFileActor: {
          kind: "interactive",
          userId: "user",
          organizationId: "org",
        },
      }),
    );
  });

  it("copies a saved storefront photo before attaching it as a reference", async () => {
    const imageUrl = "https://shop.example.com/mug.png";
    readCatalog.mockResolvedValueOnce({
      products: [{ ...selectedProduct, imageUrl }],
    });
    copyPhoto.mockResolvedValueOnce({ id: fileId, name: "Clay mug" });
    createJob.mockResolvedValueOnce({ id: "new-job", status: "QUEUED" });

    expect((await swapProduct()).status).toBe(200);
    expect(copyPhoto).toHaveBeenCalledWith({
      imageUrl,
      name: "Clay mug",
      workspaceId: "workspace",
      organizationId: "org",
      userId: "user",
    });
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceFileIds: [fileId],
      }),
    );
  });

  it("refuses a missing product before queueing any work", async () => {
    readCatalog.mockResolvedValueOnce({ products: [] });
    const response = await swapProduct();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "product_not_found" });
    expect(createJob).not.toHaveBeenCalled();
    expect(copyPhoto).not.toHaveBeenCalled();
  });

  it("replays an existing product job without preparing the current photo or buying again", async () => {
    findJob.mockResolvedValueOnce({ id: "prior-job", status: "QUEUED" });
    const response = await swapProduct();
    expect(await response.json()).toMatchObject({ job: { id: "prior-job" } });
    expect(findJob).toHaveBeenCalledWith({
      where: {
        projectId_idempotencyKey: {
          projectId: "project",
          idempotencyKey: "valid-key",
        },
      },
    });
    expect(readCatalog).not.toHaveBeenCalled();
    expect(copyPhoto).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("returns the same non-empty catalog the browser reads, after authorization", async () => {
    const response = await app.request("/options");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      catalog: JSON.parse(JSON.stringify(getImageCatalog())),
    });
    expect(getImageCatalog().models.length).toBeGreaterThan(0);
    expect(authorize).toHaveBeenCalledOnce();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("does not expose the catalog through the agent surface without authorization", async () => {
    authorize.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await app.request("/options")).status).toBe(401);
  });

  it("forwards all user settings and returns the persisted model metadata", async () => {
    const settings = {
      aspectRatio: "2:3",
      resolution: "2K",
      outputFormat: "jpeg",
      seed: 7,
    };
    createJob.mockResolvedValue({
      id: "job",
      status: "QUEUED",
      model: "fal-ai/flux-2-pro",
      settings,
    });
    const response = await app.request("/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "A cup",
        modelId: "flux-2-pro",
        ...settings,
        idempotencyKey: "valid-key",
      }),
    });
    expect(response.status).toBe(200);
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "flux-2-pro",
        settings,
        projectId: "project",
        userId: "user",
      }),
    );
    expect(await response.json()).toMatchObject({
      job: { model: "fal-ai/flux-2-pro", settings },
    });
  });

  it.each([
    { modelId: "fal-ai/arbitrary" },
    { resolution: 2000 },
    { aspectRatio: false },
  ])(
    "rejects unsupported IDs and malformed settings before creating jobs",
    async (invalid) => {
      const response = await app.request("/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "A cup",
          idempotencyKey: "valid-key",
          ...invalid,
        }),
      });
      expect(response.status).toBe(400);
      expect(createJob).not.toHaveBeenCalled();
    },
  );

  it("includes model metadata for completed jobs and their versions", async () => {
    const settings = { aspectRatio: "1:1" };
    getJob.mockResolvedValue({
      id: "job",
      status: "SUCCEEDED",
      model: "fal-ai/flux-2-pro",
      settings,
      assetId: "asset",
      error: null,
      retryMayDuplicateCharge: false,
    });
    getAsset.mockResolvedValue({
      id: "asset",
      version: 1,
      rootId: "asset",
      model: "fal-ai/flux-2-pro",
      settings,
    });
    const response = await app.request("/generations/job");
    expect(await response.json()).toMatchObject({
      job: { model: "fal-ai/flux-2-pro", settings },
      version: { model: "fal-ai/flux-2-pro", settings },
    });
  });

  it("returns version model/settings so refinements can preserve them", async () => {
    const settings = { aspectRatio: "9:16" };
    listAssets.mockResolvedValue({
      assets: [
        {
          id: "asset",
          rootId: "asset",
          parentId: null,
          version: 1,
          prompt: "A cup",
          model: "fal-ai/gemini-3-pro-image-preview",
          settings,
          width: 768,
          height: 1376,
          createdAt: new Date(),
        },
      ],
    });
    listJobs.mockResolvedValue([]);
    const response = await app.request("/versions");
    expect(await response.json()).toMatchObject({
      versions: [{ model: "fal-ai/gemini-3-pro-image-preview", settings }],
    });
  });
});
