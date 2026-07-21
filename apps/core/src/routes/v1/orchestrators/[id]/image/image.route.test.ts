import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteOrchestratorImage from "./delete";
import mountPostOrchestratorImage from "./post";

const {
  findFirstMock,
  updateMock,
  uploadOrchestratorImageMock,
  deleteOrchestratorImageIfOwnedMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  updateMock: vi.fn(),
  uploadOrchestratorImageMock: vi.fn(),
  deleteOrchestratorImageIfOwnedMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    orchestrator: {
      findFirst: findFirstMock,
      update: updateMock,
    },
  },
}));

vi.mock("@/lib/blob", () => ({
  uploadOrchestratorImage: uploadOrchestratorImageMock,
  deleteOrchestratorImageIfOwned: deleteOrchestratorImageIfOwnedMock,
}));

const ORCHESTRATOR_ID = "01960001-0001-7001-8001-000000000099";
const PREVIOUS_IMAGE =
  "https://abc.public.blob.vercel-storage.com/orchestrators/01960001-0001-7001-8001-000000000099/image-old-xyz.png";
const NEW_IMAGE =
  "https://abc.public.blob.vercel-storage.com/orchestrators/01960001-0001-7001-8001-000000000099/image-new-abc.png";

function baseOrchestrator(overrides: Record<string, unknown> = {}) {
  return {
    id: ORCHESTRATOR_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    slug: "hermes",
    name: "Hermes",
    caption: null,
    description: null,
    image: null,
    ...overrides,
  };
}

interface AppOptions {
  role?: string;
}

function createApp(options: AppOptions = {}) {
  const { role = "admin" } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_orchestrator_image_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: role === "admin" ? "admin_1" : "user_1",
      organizationId: null,
      role,
    });
    return await next();
  });

  mountPostOrchestratorImage(app as unknown as OpenAPIHonoWithAuth);
  mountDeleteOrchestratorImage(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

/** Minimal PNG signature so magic-byte sniffing accepts the fixture. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function pngFormData(filename = "logo.png", type = "image/png") {
  const form = new FormData();
  form.append("file", new File([PNG_BYTES], filename, { type }));
  return form;
}

describe("POST /orchestrators/{id}/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteOrchestratorImageIfOwnedMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uploads an image, updates the orchestrator, and deletes the previous owned image", async () => {
    findFirstMock.mockResolvedValue(
      baseOrchestrator({ image: PREVIOUS_IMAGE }),
    );
    uploadOrchestratorImageMock.mockResolvedValue(NEW_IMAGE);
    updateMock.mockResolvedValue(baseOrchestrator({ image: NEW_IMAGE }));

    const app = createApp();
    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.image).toBe(NEW_IMAGE);

    expect(uploadOrchestratorImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orchestratorId: ORCHESTRATOR_ID,
        contentType: "image/png",
        filename: "logo.png",
      }),
    );
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: ORCHESTRATOR_ID },
      data: { image: NEW_IMAGE },
    });
    expect(deleteOrchestratorImageIfOwnedMock).toHaveBeenCalledWith(
      PREVIOUS_IMAGE,
      ORCHESTRATOR_ID,
    );
  });

  it("returns 400 when file is missing", async () => {
    const app = createApp();
    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      body: new FormData(),
    });

    expect(response.status).toBe(400);
    expect(uploadOrchestratorImageMock).not.toHaveBeenCalled();
  });

  it("returns 400 for unsupported content types", async () => {
    const app = createApp();
    const form = new FormData();
    form.append(
      "file",
      new File([Buffer.from("%PDF")], "doc.pdf", { type: "application/pdf" }),
    );

    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
    expect(uploadOrchestratorImageMock).not.toHaveBeenCalled();
  });

  it("returns 400 when magic bytes are not a supported image", async () => {
    findFirstMock.mockResolvedValue(baseOrchestrator());

    const app = createApp();
    const form = new FormData();
    form.append(
      "file",
      new File([Buffer.from("not-an-image")], "logo.png", {
        type: "image/png",
      }),
    );

    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
    expect(uploadOrchestratorImageMock).not.toHaveBeenCalled();
  });

  it("returns 400 when magic bytes conflict with the declared type", async () => {
    findFirstMock.mockResolvedValue(baseOrchestrator());

    const app = createApp();
    // JPEG magic with a PNG declaration / extension.
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const form = new FormData();
    form.append(
      "file",
      new File([jpegBytes], "logo.png", { type: "image/png" }),
    );

    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
    expect(uploadOrchestratorImageMock).not.toHaveBeenCalled();
  });

  it("returns 413 when the request Content-Length exceeds the body limit", async () => {
    const app = createApp();
    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----test",
        "content-length": String(3 * 1024 * 1024),
      },
      body: "not-used-when-content-length-rejects",
    });

    expect(response.status).toBe(413);
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(uploadOrchestratorImageMock).not.toHaveBeenCalled();
  });

  it("returns 413 when the file exceeds the max size", async () => {
    const app = createApp();
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", {
        type: "image/png",
      }),
    );

    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(413);
    expect(uploadOrchestratorImageMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the orchestrator is missing or archived", async () => {
    findFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(404);
    expect(uploadOrchestratorImageMock).not.toHaveBeenCalled();
  });

  it("returns 503 when blob upload fails", async () => {
    findFirstMock.mockResolvedValue(baseOrchestrator());
    uploadOrchestratorImageMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(503);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin users", async () => {
    const app = createApp({ role: "user" });
    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(403);
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(uploadOrchestratorImageMock).not.toHaveBeenCalled();
  });

  it("deletes the new blob when the DB update fails after upload", async () => {
    findFirstMock.mockResolvedValue(
      baseOrchestrator({ image: PREVIOUS_IMAGE }),
    );
    uploadOrchestratorImageMock.mockResolvedValue(NEW_IMAGE);
    updateMock.mockRejectedValue(new Error("db write failed"));

    const app = createApp();
    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(500);
    expect(deleteOrchestratorImageIfOwnedMock).toHaveBeenCalledWith(
      NEW_IMAGE,
      ORCHESTRATOR_ID,
    );
    expect(deleteOrchestratorImageIfOwnedMock).not.toHaveBeenCalledWith(
      PREVIOUS_IMAGE,
      ORCHESTRATOR_ID,
    );
  });
});

describe("DELETE /orchestrators/{id}/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteOrchestratorImageIfOwnedMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clears the image and deletes the previous owned blob", async () => {
    findFirstMock.mockResolvedValue(
      baseOrchestrator({ image: PREVIOUS_IMAGE }),
    );
    updateMock.mockResolvedValue(baseOrchestrator({ image: null }));

    const app = createApp();
    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.image).toBeNull();

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: ORCHESTRATOR_ID },
      data: { image: null },
    });
    expect(deleteOrchestratorImageIfOwnedMock).toHaveBeenCalledWith(
      PREVIOUS_IMAGE,
      ORCHESTRATOR_ID,
    );
  });

  it("returns 404 when the orchestrator is missing", async () => {
    findFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin users", async () => {
    const app = createApp({ role: "user" });
    const response = await app.request(`/${ORCHESTRATOR_ID}/image`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
