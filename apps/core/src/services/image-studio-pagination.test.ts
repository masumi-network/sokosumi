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

const { assetFindManyMock, assetFindFirstMock, requireProjectAccessMock } =
  vi.hoisted(() => ({
    assetFindManyMock: vi.fn(),
    assetFindFirstMock: vi.fn(),
    requireProjectAccessMock: vi.fn(),
  }));

vi.mock("@/config/env", () => ({ getEnv: () => ({}) }));
vi.mock("@vercel/blob", () => ({ get: vi.fn() }));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: requireProjectAccessMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectImageAsset: {
      findMany: assetFindManyMock,
      findFirst: assetFindFirstMock,
    },
    projectImageReview: { upsert: vi.fn(), deleteMany: vi.fn() },
    projectImageJob: { findMany: vi.fn(), findFirst: vi.fn() },
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
    review: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireProjectAccessMock.mockResolvedValue(SCOPE);
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
  });
});
