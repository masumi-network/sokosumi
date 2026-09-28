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
  });
});

describe("agent catalog and generation HTTP contract", () => {
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
      review: null,
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
          review: null,
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
