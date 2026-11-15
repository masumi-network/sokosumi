import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountGet from "./get.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  findGoogleSheetLinkMock,
  loadEditableResourceMock,
  resolveFileRequestContextMock,
} = vi.hoisted(() => ({
  findGoogleSheetLinkMock: vi.fn(),
  loadEditableResourceMock: vi.fn(),
  resolveFileRequestContextMock: vi.fn(),
}));

vi.mock("@/services/drive-google-sheet.service", () => ({
  findGoogleSheetLink: findGoogleSheetLinkMock,
}));
vi.mock("@/services/file-metadata.service", () => ({
  loadEditableResource: loadEditableResourceMock,
}));
vi.mock("@/helpers/file-workspace", () => ({
  resolveFileRequestContext: resolveFileRequestContextMock,
}));

const AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

const RESOURCE_ID = "11111111-1111-4111-8111-111111111111";

function get() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", AUTH);
    c.set("requestId", "req_123");
    await next();
  });
  mountGet(app);
  return app.request(`/${RESOURCE_ID}/google-sheet?scope=me`);
}

beforeEach(() => {
  findGoogleSheetLinkMock.mockReset().mockResolvedValue(null);
  loadEditableResourceMock.mockReset().mockResolvedValue({ id: RESOURCE_ID });
  resolveFileRequestContextMock.mockReset().mockResolvedValue({
    workspaceId: "ws_1",
    actor: { userId: "user_123", organizationId: null, kind: "interactive" },
  });
});

/**
 * Drive asks this for every PDF or text file it opens. A 404 for a plain
 * file put a failed request in the browser console on each open.
 */
describe("GET /{id}/google-sheet", () => {
  it("answers 204 for a plain file", async () => {
    const response = await get();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("returns the link for a linked sheet", async () => {
    findGoogleSheetLinkMock.mockResolvedValue({
      resourceId: RESOURCE_ID,
      pathname: "drive/users/user_123/Model.pdf",
      name: "Model.pdf",
      url: "https://docs.google.com/spreadsheets/d/abc/edit",
      syncedAt: new Date("2026-11-01T00:00:00.000Z"),
      error: null,
    });

    const response = await get();

    expect(response.status).toBe(200);
    expect((await response.json()).data.name).toBe("Model.pdf");
  });

  it("still answers 404 for a file the caller cannot see", async () => {
    loadEditableResourceMock.mockResolvedValue(null);

    expect((await get()).status).toBe(404);
  });
});
