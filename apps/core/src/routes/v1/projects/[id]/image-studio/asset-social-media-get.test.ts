import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  beta: vi.fn(),
  ensure: vi.fn(),
  head: vi.fn(),
}));

vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: mocks.access,
}));
vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: mocks.beta,
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/image-studio-drive.service", () => ({
  ensureStudioAssetDriveFile: mocks.ensure,
}));
vi.mock("@vercel/blob", () => ({
  head: mocks.head,
}));

import mount from "./asset-social-media-get";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ASSET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createApp() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "studio-social-media-request");
    c.set("authContext", {
      actor: "user",
      authenticationMethod: "session",
      userId: "user-a",
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: "workspace-a",
      userId: "user-a",
      organizationId: null,
    });
    await next();
  });
  mount(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({
    projectId: PROJECT_ID,
    workspaceId: "workspace-a",
    userId: "user-a",
    organizationId: null,
  });
  mocks.beta.mockResolvedValue(undefined);
  mocks.ensure.mockResolvedValue({
    id: "file-9",
    name: "a-red-fox-3f2a9c1d.png",
    pathname: "drive/users/user-a/Content Studio/a-red-fox-3f2a9c1d.png",
    mimeType: "image/png",
    size: 12,
  });
  mocks.head.mockResolvedValue({
    url: "https://store.public.blob.vercel-storage.com/drive/users/user-a/Content%20Studio/a-red-fox-3f2a9c1d.png",
  });
});

describe("GET /projects/{id}/image-studio/assets/{assetId}/social-media", () => {
  it("returns a Drive file Social can attach", async () => {
    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/social-media`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        pathname: "drive/users/user-a/Content Studio/a-red-fox-3f2a9c1d.png",
        name: "a-red-fox-3f2a9c1d.png",
        size: 12,
        mimeType: "image/png",
        kind: "image",
      },
    });
    expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
      workspaceId: "workspace-a",
      organizationId: null,
      userId: "user-a",
    });
  });

  it("hides Social from a caller outside the beta", async () => {
    mocks.beta.mockRejectedValue(
      new HTTPException(403, {
        message: "Social is only available to utxo AG workspace members",
      }),
    );

    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/social-media`,
    );

    expect(response.status).toBe(403);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("returns 404 when the image is gone", async () => {
    mocks.ensure.mockResolvedValue(null);

    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/social-media`,
    );

    expect(response.status).toBe(404);
  });
});
