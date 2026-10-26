import { OpenAPIHono } from "@hono/zod-openapi";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: mocks.access,
}));
vi.mock("@/services/image-studio-caption.service", () => ({
  writeStudioAssetCaption: mocks.write,
}));

import mount from "./asset-caption-post";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ASSET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createApp() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "studio-caption-request");
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
  mocks.write.mockResolvedValue(ok("Late sun on a red fox."));
});

describe("POST /projects/{id}/image-studio/assets/{assetId}/caption", () => {
  it("returns a caption for the image", async () => {
    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/caption`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { text: "Late sun on a red fox." },
    });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
    });
  });

  it("returns 404 when the image is gone", async () => {
    mocks.write.mockResolvedValue(err("missing"));

    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/caption`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
  });

  it("returns 503 when writing fails", async () => {
    mocks.write.mockRejectedValue(new Error("gateway down"));

    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/caption`,
      { method: "POST" },
    );

    expect(response.status).toBe(503);
  });

  it("returns 503 when the model writes nothing", async () => {
    mocks.write.mockResolvedValue(err("empty"));

    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/caption`,
      { method: "POST" },
    );

    expect(response.status).toBe(503);
  });
});
