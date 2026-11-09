import { OpenAPIHono } from "@hono/zod-openapi";
import { ENTITY_IMAGE_MAX_SIZE_BYTES } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";

const mocks = vi.hoisted(() => ({
  requireProjectAccess: vi.fn(),
  uploadProjectLogoBytes: vi.fn(),
  updateProject: vi.fn(),
  findProject: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: mocks.fetch,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { project: { findUnique: mocks.findProject } },
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: mocks.requireProjectAccess,
}));
vi.mock("@/lib/blob", () => ({
  uploadProjectLogoBytes: mocks.uploadProjectLogoBytes,
}));
vi.mock("@/services/projects.service", () => ({
  updateProject: mocks.updateProject,
}));

import mount from "./brand-logo-post";
import mountWebsite from "./brand-logo-website-post";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const logo = `https://test.public.blob.vercel-storage.com/projects/${projectId}/logos/approved`;
const path = `/${projectId}/image-studio/brand-kit/logo`;
const scope = { projectId, workspaceId: "workspace-a", userId: "user-a" };

function createApp() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "studio-logo");
    c.set("authContext", {
      actor: "user",
      authenticationMethod: "session",
      userId: scope.userId,
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      organizationId: null,
    });
    await next();
  });
  mount(app);
  mountWebsite(app);
  return app;
}

function upload(file: File) {
  const body = new FormData();
  body.append("file", file);
  return createApp().request(path, { method: "POST", body });
}

function png(width = 32, height = 32) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 180, b: 0, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
}

function pngFile(bytes: Buffer) {
  return new File([new Uint8Array(bytes)], "approved.png", {
    type: "image/png",
  });
}

describe("Studio project logo upload", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.uploadProjectLogoBytes.mockResolvedValue(logo);
  });

  it("validates the bytes and replaces the canonical project logo", async () => {
    const bytes = await png();
    const response = await upload(pngFile(bytes));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { logo } });
    expect(mocks.requireProjectAccess.mock.calls).toEqual([[scope], [scope]]);
    expect(mocks.uploadProjectLogoBytes).toHaveBeenCalledExactlyOnceWith({
      projectId,
      bytes,
      contentType: "image/png",
    });
    expect(mocks.updateProject).toHaveBeenCalledExactlyOnceWith(
      scope.workspaceId,
      projectId,
      { logo },
    );
  });

  it("rejects fake, unreadable, and oversized images before storage", async () => {
    const bytes = await png();
    const invalidFiles = [
      pngFile(Buffer.from("<svg/>")),
      pngFile(bytes.subarray(0, 16)),
      pngFile(await png(2001, 2000)),
    ];
    for (const file of invalidFiles) {
      expect((await upload(file)).status).toBe(422);
    }
    const oversized = pngFile(Buffer.alloc(ENTITY_IMAGE_MAX_SIZE_BYTES + 1));
    expect((await upload(oversized)).status).toBe(413);
    expect(mocks.uploadProjectLogoBytes).not.toHaveBeenCalled();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("requires project access before storing or changing the logo", async () => {
    mocks.requireProjectAccess.mockRejectedValueOnce(new HTTPException(404));
    expect((await upload(pngFile(await png()))).status).toBe(404);
    expect(mocks.uploadProjectLogoBytes).not.toHaveBeenCalled();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("keeps the current logo when storage fails", async () => {
    mocks.uploadProjectLogoBytes.mockResolvedValueOnce(null);
    expect((await upload(pngFile(await png()))).status).toBe(503);
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });
});

describe("Studio website logo", () => {
  const website = "https://shop.example/";

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findProject.mockResolvedValue({ websiteUrl: website });
    mocks.uploadProjectLogoBytes.mockResolvedValue(logo);
  });

  it("rasterizes the declared wordmark in preference to the site icon and stages it for review", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(`
          <link rel="icon" href="/icon.png">
          <script type="application/ld+json">
            {"@graph":[{"@type":"OnlineStore","logo":{"@type":"ImageObject","contentUrl":"/wordmark.svg"}}]}
          </script>
        `),
      )
      .mockResolvedValueOnce(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="32"><rect width="128" height="32" fill="red"/></svg>',
          { headers: { "content-type": "image/svg+xml" } },
        ),
      );

    const response = await createApp().request(`${path}/website`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ websiteUrl: "https://unrelated.example" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { logo } });
    expect(mocks.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(scope);
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      website,
      "https://shop.example/wordmark.svg",
    ]);
    const staged = mocks.uploadProjectLogoBytes.mock.calls[0][0];
    expect(staged).toMatchObject({ projectId, contentType: "image/png" });
    await expect(sharp(staged.bytes).metadata()).resolves.toMatchObject({
      format: "png",
      width: 128,
      height: 32,
    });
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("resolves relative logos and fallback icons against the redirected website", async () => {
    mocks.fetch
      .mockImplementationOnce(async (_url, { onFinalUrl }) => {
        onFinalUrl("https://shop.example/coffee/");
        return new Response(`
          <link rel="apple-touch-icon" href="icon.png">
          <script type="application/ld+json">
            {"@type":"Organization","logo":"invalid.png"}
          </script>
        `);
      })
      .mockResolvedValueOnce(
        new Response("not a PNG", { headers: { "content-type": "image/png" } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(await png()), {
          headers: { "content-type": "image/png" },
        }),
      );

    const response = await createApp().request(`${path}/website`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { logo } });
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      website,
      "https://shop.example/coffee/invalid.png",
      "https://shop.example/coffee/icon.png",
    ]);
    expect(mocks.uploadProjectLogoBytes).toHaveBeenCalledOnce();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("requires project access before reading the saved website", async () => {
    mocks.requireProjectAccess.mockRejectedValueOnce(new HTTPException(404));
    const response = await createApp().request(`${path}/website`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
    expect(mocks.findProject).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
