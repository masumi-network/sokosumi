import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { TEST_VENDOR_ID, testVendor } from "@/test-fixtures/vendor.js";

import mountDeleteCoworkerImage from "./delete";
import mountPostCoworkerImage from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  findFirstMock,
  updateManyMock,
  uploadCoworkerImageMock,
  deleteCoworkerImageIfOwnedMock,
  vendorMemberFindFirstMock,
  coworkerAssignmentFindFirstMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  updateManyMock: vi.fn(),
  uploadCoworkerImageMock: vi.fn(),
  deleteCoworkerImageIfOwnedMock: vi.fn(),
  vendorMemberFindFirstMock: vi.fn(),
  coworkerAssignmentFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: findFirstMock,
      updateMany: updateManyMock,
    },
    vendorMember: {
      findFirst: vendorMemberFindFirstMock,
    },
    coworkerAssignment: {
      findFirst: coworkerAssignmentFindFirstMock,
    },
  },
}));

vi.mock("@/lib/blob", () => ({
  uploadCoworkerImage: uploadCoworkerImageMock,
  deleteCoworkerImageIfOwned: deleteCoworkerImageIfOwnedMock,
}));

const COWORKER_ID = "cow_123";
const PREVIOUS_IMAGE =
  "https://abc.public.blob.vercel-storage.com/coworkers/cow_123/image-old-xyz.png";
const NEW_IMAGE =
  "https://abc.public.blob.vercel-storage.com/coworkers/cow_123/image-new-abc.png";

function baseCoworker(overrides: Record<string, unknown> = {}) {
  return {
    id: COWORKER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userId: "user_owner",
    vendorId: TEST_VENDOR_ID,
    slug: "ops-agent",
    name: "Ops Agent",
    caption: null,
    description: null,
    url: null,
    baseURL: null,
    capabilities: [],
    image: null,
    priority: 0,
    isWhitelisted: false,
    metadata: null,
    vendor: testVendor,
    ...overrides,
  };
}

interface AppOptions {
  role?: string;
  userId?: string;
}

function createApp(options: AppOptions = {}) {
  const { role = "admin", userId = "admin_1" } = options;
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_coworker_image_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role,
    });
    return await next();
  });

  mountPostCoworkerImage(app);
  mountDeleteCoworkerImage(app);

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

function mockMembershipAccess(
  options: { assigned?: boolean; vendorAdmin?: boolean } = {},
) {
  vendorMemberFindFirstMock.mockResolvedValue(
    options.vendorAdmin ? { id: "vm_admin" } : null,
  );
  coworkerAssignmentFindFirstMock.mockResolvedValue(
    options.assigned ? { id: "assign_1" } : null,
  );
}

function mockCoworkerManagementLookup() {
  findFirstMock.mockResolvedValueOnce({
    id: COWORKER_ID,
    vendorId: TEST_VENDOR_ID,
  });
}

describe("POST /coworkers/{id}/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteCoworkerImageIfOwnedMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uploads an image, updates the coworker, and deletes the previous owned image", async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: COWORKER_ID, image: PREVIOUS_IMAGE })
      .mockResolvedValueOnce(baseCoworker({ image: NEW_IMAGE }));
    uploadCoworkerImageMock.mockResolvedValue(NEW_IMAGE);
    updateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp();
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.image).toBe(NEW_IMAGE);

    expect(uploadCoworkerImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: COWORKER_ID,
        contentType: "image/png",
        filename: "logo.png",
      }),
    );
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: COWORKER_ID },
      data: { image: NEW_IMAGE },
    });
    expect(deleteCoworkerImageIfOwnedMock).toHaveBeenCalledWith(
      PREVIOUS_IMAGE,
      COWORKER_ID,
    );
  });

  it("returns 422 when file is missing", async () => {
    const app = createApp();
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: new FormData(),
    });

    expect(response.status).toBe(422);
    expect(uploadCoworkerImageMock).not.toHaveBeenCalled();
  });

  it("returns 400 for unsupported content types", async () => {
    const app = createApp();
    const form = new FormData();
    form.append(
      "file",
      new File([Buffer.from("%PDF")], "doc.pdf", { type: "application/pdf" }),
    );

    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
    expect(uploadCoworkerImageMock).not.toHaveBeenCalled();
  });

  it("returns 400 when magic bytes are not a supported image", async () => {
    findFirstMock.mockResolvedValue({ id: COWORKER_ID, image: null });

    const app = createApp();
    const form = new FormData();
    form.append(
      "file",
      new File([Buffer.from("not-an-image")], "logo.png", {
        type: "image/png",
      }),
    );

    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
    expect(uploadCoworkerImageMock).not.toHaveBeenCalled();
  });

  it("uploads using sniffed bytes when the browser MIME disagrees but both are allowed", async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: COWORKER_ID, image: null })
      .mockResolvedValueOnce(baseCoworker({ image: NEW_IMAGE }));
    uploadCoworkerImageMock.mockResolvedValue(NEW_IMAGE);
    updateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp();
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const form = new FormData();
    form.append(
      "file",
      new File([jpegBytes], "logo.png", { type: "image/png" }),
    );

    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(200);
    expect(uploadCoworkerImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: COWORKER_ID,
        contentType: "image/jpeg",
        filename: "logo.png",
      }),
    );
  });

  it("returns 403 for non-admin user without membership access", async () => {
    mockCoworkerManagementLookup();
    mockMembershipAccess({ assigned: false, vendorAdmin: false });

    const app = createApp({ role: "user", userId: "user_1" });
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(403);
    expect(uploadCoworkerImageMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the coworker is missing or archived", async () => {
    findFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(404);
    expect(uploadCoworkerImageMock).not.toHaveBeenCalled();
  });

  it("returns 503 when blob upload fails", async () => {
    findFirstMock.mockResolvedValue({ id: COWORKER_ID, image: null });
    uploadCoworkerImageMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(503);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("allows an assigned developer to upload an image", async () => {
    mockCoworkerManagementLookup();
    mockMembershipAccess({ assigned: true });
    findFirstMock
      // route loads current image
      .mockResolvedValueOnce({ id: COWORKER_ID, image: PREVIOUS_IMAGE })
      // route reloads coworker after update
      .mockResolvedValueOnce(baseCoworker({ image: NEW_IMAGE }));
    uploadCoworkerImageMock.mockResolvedValue(NEW_IMAGE);
    updateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp({ role: "user", userId: "user_owner" });
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.image).toBe(NEW_IMAGE);
    expect(uploadCoworkerImageMock).toHaveBeenCalled();
    expect(deleteCoworkerImageIfOwnedMock).toHaveBeenCalledWith(
      PREVIOUS_IMAGE,
      COWORKER_ID,
    );
  });

  it("deletes the new blob when the DB update fails after upload", async () => {
    findFirstMock.mockResolvedValue({ id: COWORKER_ID, image: PREVIOUS_IMAGE });
    uploadCoworkerImageMock.mockResolvedValue(NEW_IMAGE);
    updateManyMock.mockRejectedValue(new Error("db write failed"));

    const app = createApp();
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(500);
    expect(deleteCoworkerImageIfOwnedMock).toHaveBeenCalledWith(
      NEW_IMAGE,
      COWORKER_ID,
    );
    expect(deleteCoworkerImageIfOwnedMock).not.toHaveBeenCalledWith(
      PREVIOUS_IMAGE,
      COWORKER_ID,
    );
  });

  it("returns 404 and deletes the new blob when the coworker is archived during upload", async () => {
    findFirstMock.mockResolvedValue({ id: COWORKER_ID, image: PREVIOUS_IMAGE });
    uploadCoworkerImageMock.mockResolvedValue(NEW_IMAGE);
    updateManyMock.mockResolvedValue({ count: 0 });

    const app = createApp();
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "POST",
      body: pngFormData(),
    });

    expect(response.status).toBe(404);
    expect(deleteCoworkerImageIfOwnedMock).toHaveBeenCalledWith(
      NEW_IMAGE,
      COWORKER_ID,
    );
    expect(deleteCoworkerImageIfOwnedMock).not.toHaveBeenCalledWith(
      PREVIOUS_IMAGE,
      COWORKER_ID,
    );
  });
});

describe("DELETE /coworkers/{id}/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteCoworkerImageIfOwnedMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clears the image and deletes the previous owned blob", async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: COWORKER_ID, image: PREVIOUS_IMAGE })
      .mockResolvedValueOnce(baseCoworker({ image: null }));
    updateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp();
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.image).toBeNull();

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: COWORKER_ID },
      data: { image: null },
    });
    expect(deleteCoworkerImageIfOwnedMock).toHaveBeenCalledWith(
      PREVIOUS_IMAGE,
      COWORKER_ID,
    );
  });

  it("allows an assigned developer to remove an image", async () => {
    mockCoworkerManagementLookup();
    mockMembershipAccess({ assigned: true });
    findFirstMock
      .mockResolvedValueOnce({ id: COWORKER_ID, image: PREVIOUS_IMAGE })
      .mockResolvedValueOnce(baseCoworker({ image: null }));
    updateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp({ role: "user", userId: "user_owner" });
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.image).toBeNull();
    expect(deleteCoworkerImageIfOwnedMock).toHaveBeenCalledWith(
      PREVIOUS_IMAGE,
      COWORKER_ID,
    );
  });

  it("returns 404 when the coworker is missing", async () => {
    findFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(`/${COWORKER_ID}/image`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
  });
});
