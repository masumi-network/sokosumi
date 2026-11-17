import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";

const mocks = vi.hoisted(() => ({
  openAssetStream: vi.fn(),
  findProject: vi.fn(),
  downloadLogo: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock("@/services/image-studio-assets.service", () => ({
  openAssetStream: mocks.openAssetStream,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findUnique: mocks.findProject },
    adEvent: { create: mocks.eventCreate },
  },
}));
vi.mock("@/lib/remote-image", () => ({
  downloadRemoteImage: mocks.downloadLogo,
}));

import mount from "./asset-content-get";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const assetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const path = `/${projectId}/image-studio/assets/${assetId}/content`;
const logo = `https://abc123.public.blob.vercel-storage.com/projects/${projectId}/logos/logo`;

function app() {
  const server = new OpenAPIHono<EnvVariables>();
  server.use("*", async (c, next) => {
    c.set("requestId", "studio-export");
    c.set("authContext", {
      actor: "user",
      authenticationMethod: "session",
      userId: "user-a",
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      userId: "user-a",
      workspaceId: "workspace-a",
      organizationId: null,
    });
    await next();
  });
  mount(server);
  return server;
}

describe("Studio branded asset content", () => {
  beforeEach(() => vi.resetAllMocks());

  it("renders the project's logo into an authorized image without caching the derivative", async () => {
    const [ad, artwork] = await Promise.all([
      sharp({
        create: { width: 160, height: 120, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer(),
      sharp({
        create: { width: 12, height: 12, channels: 4, background: "#aa3311" },
      })
        .png()
        .toBuffer(),
    ]);
    mocks.openAssetStream.mockResolvedValueOnce({
      stream: new Response(new Uint8Array(ad)).body,
      contentType: "application/octet-stream",
      mediaType: "IMAGE",
      size: ad.length,
    });
    mocks.findProject.mockResolvedValueOnce({ logo });
    mocks.downloadLogo.mockResolvedValueOnce({
      bytes: new Uint8Array(artwork).buffer,
    });

    const response = await app().request(
      `${path}?logo=bottom-right&download=true`,
      {
        headers: { Range: "bytes=0-10" },
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.openAssetStream).toHaveBeenCalledExactlyOnceWith({
      projectId,
      assetId,
      userId: "user-a",
      workspaceId: "workspace-a",
    });
    expect(mocks.downloadLogo).toHaveBeenCalledWith(logo, expect.any(Object));
    expect(mocks.eventCreate).toHaveBeenCalledExactlyOnceWith({
      data: {
        workspaceId: "workspace-a",
        userId: "user-a",
        assetId,
        type: "downloaded",
        meta: undefined,
      },
    });
    expect(await sharp(await response.arrayBuffer()).metadata()).toMatchObject({
      format: "png",
      width: 160,
      height: 120,
    });
  });

  it("does not read the project logo when the source image is inaccessible", async () => {
    mocks.openAssetStream.mockRejectedValueOnce(new HTTPException(404));
    expect((await app().request(`${path}?logo=top-left`)).status).toBe(404);
    expect(mocks.findProject).not.toHaveBeenCalled();
    expect(mocks.downloadLogo).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it("exports the selected crop with no logo lookup when branding is off", async () => {
    const ad = await sharp({
      create: { width: 160, height: 120, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    mocks.openAssetStream.mockResolvedValueOnce({
      stream: new Response(new Uint8Array(ad)).body,
      mediaType: "IMAGE",
      size: ad.length,
    });

    const response = await app().request(`${path}?placement=4%3A5`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("-4x5.png");
    expect(mocks.findProject).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
    await expect(
      sharp(await response.arrayBuffer()).metadata(),
    ).resolves.toMatchObject({
      width: 96,
      height: 120,
      format: "png",
    });
  });

  it.each([false, true])(
    "logs explicit original downloads only (download=%s)",
    async (download) => {
      mocks.openAssetStream.mockResolvedValueOnce({
        stream: new Response(new Uint8Array([1, 2])).body,
        contentType: "image/png",
        size: 2,
        checksum: "sha",
      });
      mocks.eventCreate.mockRejectedValueOnce(
        new Error("event store unavailable"),
      );
      const response = await app().request(
        download ? `${path}?download=true` : path,
      );
      expect(response.status).toBe(200);
      expect(mocks.eventCreate).toHaveBeenCalledTimes(download ? 1 : 0);
      expect((await response.arrayBuffer()).byteLength).toBe(2);
    },
  );
});
