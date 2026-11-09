import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";

const { allowProject, createMany, updateMany, downloadPhoto, writePhoto } =
  vi.hoisted(() => ({
    allowProject: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn(),
    downloadPhoto: vi.fn(),
    writePhoto: vi.fn(),
  }));

vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: allowProject,
}));

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (tx: unknown) => unknown) =>
    run({
      project: { findUnique: async () => ({ id: PROJECT_ID }) },
      projectStudioProductCatalog: { createMany, updateMany },
    }),
}));

vi.mock("@/lib/remote-image", () => ({
  downloadRemoteImage: downloadPhoto,
}));

vi.mock("@/services/image-studio-drive.service", () => ({
  writeStudioDriveFile: writePhoto,
}));

import mountPhoto from "./photo/post";
import mount from "./put";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function createApp() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "studio-catalog");
    c.set("authContext", {
      actor: "user",
      authenticationMethod: "session",
      userId: "user-a",
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: "workspace-a",
      organizationId: null,
      userId: "user-a",
    });
    await next();
  });
  mount(app);
  mountPhoto(app);
  return app;
}

function save(revision: number) {
  return createApp().request(`/${PROJECT_ID}/image-studio/products`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ products: [], revision }),
  });
}

describe("Studio catalog writes", () => {
  beforeEach(() => vi.resetAllMocks());

  it("creates the first catalog only once", async () => {
    createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await save(0);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      data: { products: [], revision: 1 },
    });
    expect(allowProject).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, workspaceId: "workspace-a", userId: "user-a" },
      expect.any(Object),
    );
    expect(createMany).toHaveBeenCalledWith({
      data: { projectId: PROJECT_ID, products: [], revision: 1 },
      skipDuplicates: true,
    });
    expect((await save(0)).status).toBe(409);
  });

  it("rejects a save based on a stale revision", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await save(3)).status).toBe(409);
    expect(updateMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, revision: 3 },
      data: { products: [], revision: { increment: 1 } },
    });
  });
});

describe("Studio catalog photos", () => {
  beforeEach(() => vi.resetAllMocks());

  function attach() {
    return createApp().request(`/${PROJECT_ID}/image-studio/products/photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Vase",
        imageUrl: "https://store.example.com/vase.png",
      }),
    });
  }

  it("stores verified photo bytes in the active workspace and returns the file reference", async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    allowProject.mockResolvedValueOnce({ organizationId: "org-a" });
    downloadPhoto.mockResolvedValueOnce({
      bytes: bytes.buffer,
      contentType: "image/png",
    });
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    writePhoto.mockResolvedValueOnce({ id });

    const result = await attach();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ data: { id, name: "Vase" } });
    expect(writePhoto).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      organizationId: "org-a",
      userId: "user-a",
      name: expect.stringMatching(/^product-photo-[a-f0-9]{32}\.png$/),
      bytes,
      contentType: "image/png",
    });
  });

  it("never fetches a photo before access to the project is established", async () => {
    allowProject.mockRejectedValueOnce(new HTTPException(404));
    expect((await attach()).status).toBe(404);
    expect(downloadPhoto).not.toHaveBeenCalled();
    expect(writePhoto).not.toHaveBeenCalled();
  });
});
