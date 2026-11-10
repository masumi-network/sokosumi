import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioAdArchive } from "./studio-ad-archive";
import type { StudioAsset } from "./types";

const ASSET: StudioAsset = {
  id: "asset-a",
  projectId: "project-a",
  projectName: "Launch",
  rootId: "asset-a",
  parentId: null,
  version: 1,
  prompt: "New product",
  model: "vendor/model-a",
  width: 1080,
  height: 1350,
  bytes: 3,
  contentType: "image/png",
  mediaType: "IMAGE",
  video: null,
  createdAt: new Date("2026-09-26T12:00:00Z"),
  jobId: "job-a",
  settings: { aspectRatio: "4:5", resolution: "1K", outputFormat: "png" },
  contentPath: "/asset-a",
};

describe("downloading selected Studio ads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the original bytes and gives same-size images unique names", async () => {
    const fetchAsset = vi
      .fn()
      .mockResolvedValueOnce(new Response("one"))
      .mockResolvedValueOnce(new Response("two"))
      .mockResolvedValueOnce(new Response("three"));
    vi.stubGlobal("fetch", fetchAsset);
    const data = await createStudioAdArchive([
      ASSET,
      { ...ASSET, id: "asset-b" },
      {
        ...ASSET,
        id: "asset-c",
        contentType: "image/webp",
        settings: { ...ASSET.settings, outputFormat: undefined },
      },
    ]);
    const zip = await JSZip.loadAsync(data);

    expect(fetchAsset.mock.calls.map(([url]) => url)).toEqual([
      "/api/projects/project-a/image-studio/assets/asset-a/content",
      "/api/projects/project-a/image-studio/assets/asset-b/content",
      "/api/projects/project-a/image-studio/assets/asset-c/content",
    ]);
    expect(await zip.file("ad-1-1080x1350.png")?.async("text")).toBe("one");
    expect(await zip.file("ad-2-1080x1350.png")?.async("text")).toBe("two");
    expect(await zip.file("ad-3-1080x1350.webp")?.async("text")).toBe("three");
  });

  it("fails the entire export when a selected image is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("one"))
        .mockResolvedValueOnce(new Response(null, { status: 404 })),
    );
    await expect(
      createStudioAdArchive([ASSET, { ...ASSET, id: "asset-b" }]),
    ).rejects.toThrow("Studio image returned 404");
  });
});
