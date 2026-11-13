import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * History paging.
 *
 * An independent review reproduced a page that skipped 100 images: the cursor
 * was read after the pinned version had been appended, so the next page
 * started just past that version instead of just past the page. These tests
 * pin the two properties that stops happening again — the cursor comes from
 * the page, and it identifies a row rather than an instant.
 */

const {
  assetFindManyMock,
  assetFindFirstMock,
  requireProjectAccessMock,
  requireWorkspaceAccessMock,
  feedbackGroupByMock,
  eventGroupByMock,
} = vi.hoisted(() => ({
  assetFindManyMock: vi.fn(),
  assetFindFirstMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  requireWorkspaceAccessMock: vi.fn(),
  feedbackGroupByMock: vi.fn(),
  eventGroupByMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: () => ({}) }));
vi.mock("@vercel/blob", () => ({ get: vi.fn() }));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: requireProjectAccessMock,
  requireWorkspaceAccess: requireWorkspaceAccessMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageAsset: {
      findMany: assetFindManyMock,
      findFirst: assetFindFirstMock,
    },
    projectImageJob: { findMany: vi.fn(), findFirst: vi.fn() },
    adFeedback: {
      groupBy: feedbackGroupByMock,
      findMany: vi.fn().mockResolvedValue([]),
    },
    adEvent: { groupBy: eventGroupByMock },
  },
}));

import { listAssets } from "@/services/image-studio-assets.service";

const SCOPE = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  userId: "user-1",
};

function asset(index: number, createdAt: Date) {
  return {
    id: `asset-${String(index).padStart(3, "0")}`,
    projectId: "project-1",
    project: { name: "Launch" },
    createdAt,
    settings: {},
    rootId: "root",
    parentId: null,
    version: index,
    prompt: "p",
    model: "m",
    width: 1,
    height: 1,
    bytes: 1,
    contentType: "image/png",
    jobId: `job-${index}`,
    job: { productId: null, productName: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireProjectAccessMock.mockResolvedValue(SCOPE);
  feedbackGroupByMock.mockResolvedValue([]);
  eventGroupByMock.mockResolvedValue([]);
});

describe("listAssets", () => {
  it("takes the cursor from the page, not from the pinned version", async () => {
    const base = Date.now();
    // A full page, plus one to signal there is more.
    const page = Array.from({ length: 4 }, (_, index) =>
      asset(200 - index, new Date(base - index * 1000)),
    );
    assetFindManyMock.mockResolvedValue(page);
    // The pinned version is far older than anything on this page.
    assetFindFirstMock.mockResolvedValue(asset(1, new Date(base - 10_000_000)));

    const result = await listAssets({
      ...SCOPE,
      limit: 3,
      pinnedAssetId: "asset-001",
    });

    // The next page must continue from the end of *this page*. Continuing
    // from the pinned version skipped everything in between.
    expect(result.nextCursor).toEqual({
      createdAt: page[2]!.createdAt,
      id: page[2]!.id,
    });
    expect(result.assets.map((a) => a.id)).toContain("asset-001");
  });

  it("orders and seeks by (createdAt, id) so ties are not stepped over", async () => {
    assetFindManyMock.mockResolvedValue([]);
    const createdAt = new Date("2026-09-25T00:00:00.000Z");

    await listAssets({
      ...SCOPE,
      limit: 10,
      before: { createdAt, id: "asset-050" },
    });

    const call = assetFindManyMock.mock.calls[0]![0];
    expect(call.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    // Strictly older, or the same instant with a lower id — which is what
    // keeps two versions settled in the same millisecond both reachable.
    expect(call.where.OR).toEqual([
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: "asset-050" } },
    ]);
  });

  it("reports no cursor once the end is reached", async () => {
    assetFindManyMock.mockResolvedValue([asset(2, new Date())]);
    const result = await listAssets({ ...SCOPE, limit: 10 });
    expect(result.nextCursor).toBeNull();
    expect(result.assets[0]).not.toHaveProperty("product");
    expect(result.assets[0]).not.toHaveProperty("batchId");
  });

  it("returns the job's saved product with the asset", async () => {
    assetFindManyMock.mockResolvedValue([
      {
        ...asset(2, new Date()),
        job: { productId: "product-a", productName: "Clay mug" },
      },
    ]);

    const result = await listAssets({ ...SCOPE, limit: 10 });

    expect(result.assets[0]).toMatchObject({
      product: { id: "product-a", name: "Clay mug" },
    });
    expect(result.assets[0]).not.toHaveProperty("job");
  });

  it("reads every project in the workspace when no project is named", async () => {
    assetFindManyMock.mockResolvedValue([asset(2, new Date())]);

    const result = await listAssets({ ...SCOPE, projectId: null, limit: 10 });

    // Membership of the workspace, not of one project, is the check.
    expect(requireWorkspaceAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", userId: "user-1" }),
    );
    expect(requireProjectAccessMock).not.toHaveBeenCalled();
    expect(assetFindManyMock.mock.calls[0]![0].where).toMatchObject({
      project: { workspaceId: "workspace-1" },
    });
    expect(result.assets[0]).toMatchObject({
      projectId: "project-1",
      projectName: "Launch",
    });
    expect(result.assets[0]).not.toHaveProperty("project");
  });

  it("refuses the workspace view to a caller who is no longer a member", async () => {
    requireWorkspaceAccessMock.mockRejectedValue(new Error("not found"));

    await expect(
      listAssets({ ...SCOPE, projectId: null, limit: 10 }),
    ).rejects.toThrow("not found");
    expect(assetFindManyMock).not.toHaveBeenCalled();
  });

  it("excludes hidden assets, including a pinned hidden version", async () => {
    assetFindManyMock.mockResolvedValue([]);
    assetFindFirstMock.mockResolvedValue(null);
    await listAssets({ ...SCOPE, limit: 10, pinnedAssetId: "hidden-asset" });
    expect(assetFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hiddenAt: null }),
      }),
    );
    expect(assetFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hiddenAt: null }),
      }),
    );
  });

  it("ranks the whole project before paging, with newest first for score ties", async () => {
    const newest = asset(3, new Date("2026-11-12"));
    const second = asset(2, new Date("2026-11-11"));
    const oldest = asset(1, new Date("2026-11-10"));
    assetFindManyMock
      .mockResolvedValueOnce([newest, second, oldest])
      .mockResolvedValueOnce([oldest, newest]);
    feedbackGroupByMock.mockResolvedValue([
      { assetId: oldest.id, thumb: 1, _count: { _all: 2 } },
    ]);
    const result = await listAssets({ ...SCOPE, limit: 2, sort: "best" });
    expect(result.assets.map((row) => row.id)).toEqual([oldest.id, newest.id]);
    expect(result.nextCursor).toEqual({
      id: newest.id,
      createdAt: newest.createdAt,
    });
    expect(result.assets[0]!.thumbsUp).toBe(2);
  });

  it("continues Best first after the ranked id rather than its creation time", async () => {
    const newest = asset(3, new Date("2026-11-12"));
    const oldest = asset(1, new Date("2026-11-10"));
    assetFindManyMock
      .mockResolvedValueOnce([newest, oldest])
      .mockResolvedValueOnce([newest]);
    feedbackGroupByMock.mockResolvedValue([
      { assetId: oldest.id, thumb: 1, _count: { _all: 2 } },
    ]);
    const result = await listAssets({
      ...SCOPE,
      limit: 2,
      sort: "best",
      before: { id: oldest.id, createdAt: oldest.createdAt },
    });
    expect(result.assets.map((row) => row.id)).toEqual([newest.id]);
    expect(result.nextCursor).toBeNull();
  });

  it("ends a ranked page chain when its anchor was hidden instead of duplicating the first page", async () => {
    assetFindManyMock.mockResolvedValue([asset(3, new Date())]);
    const result = await listAssets({
      ...SCOPE,
      limit: 2,
      sort: "best",
      before: { id: "hidden-asset", createdAt: new Date() },
    });
    expect(result.assets).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});
