import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mount from "./get";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  blob: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("@/middleware/auth", async (original) => {
  const actual = await original<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
vi.mock("@/helpers/access-control", () => ({
  requireJobReadForRouteVars: mocks.access,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { blob: { findFirst: mocks.blob } },
}));
vi.mock("@/services/file-content.service", async (original) => ({
  ...(await original<typeof import("@/services/file-content.service")>()),
  openStoredFileContentStream: mocks.stream,
}));
function app() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  mount(app);
  return app;
}
describe("authorized job output bytes", () => {
  beforeEach(() => vi.clearAllMocks());
  it("denies revoked job access before reading an output or storage", async () => {
    mocks.access.mockRejectedValue(forbidden("Denied"));
    const response = await app().request("/job/files/file/content");
    expect(response.status).toBe(403);
    expect(mocks.blob).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it("requires a ready output belonging to exactly the authorized job", async () => {
    mocks.access.mockResolvedValue({ id: "job" });
    mocks.blob.mockResolvedValue(null);
    const response = await app().request("/job/files/foreign/content");
    expect(response.status).toBe(404);
    expect(mocks.blob).toHaveBeenCalledWith({
      where: {
        id: "foreign",
        event: { jobId: "job" },
        status: "READY",
        fileUrl: { not: null },
      },
    });
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it("streams protected bytes with download and safe response headers", async () => {
    mocks.access.mockResolvedValue({ id: "job" });
    mocks.blob.mockResolvedValue({
      id: "file",
      fileUrl: "stored-object",
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 3n,
      updatedAt: new Date(0),
    });
    mocks.stream.mockResolvedValue({
      stream: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("pdf"));
          c.close();
        },
      }),
      contentType: "application/pdf",
      size: 3,
      displayName: "report.pdf",
      entityTag: "file-0",
      inline: false,
    });
    const response = await app().request(
      "/job/files/file/content?download=true",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("pdf");
    expect(mocks.stream).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: "stored-object", download: true }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'",
    );
    expect([...response.headers.values()].join(" ")).not.toContain(
      "stored-object",
    );
  });
});
