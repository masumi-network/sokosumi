import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn(async () => undefined);
const listAuditsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/services/seo.service", () => ({
  seoService: { listAudits: listAuditsMock },
}));

const { loadSeoAuditIndex } = await import("./seo-page-data");

const INDEX = { audits: [{ id: "audit-1" }], pagination: null };

describe("loadSeoAuditIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAuditsMock.mockReset();
  });

  // connection() would drop the page from every link prefetch.
  it("reads the page without deferring to the request", async () => {
    listAuditsMock.mockResolvedValue(INDEX);

    const index = await loadSeoAuditIndex({ projectId: "project-1" });

    expect(index).toEqual(INDEX);
    expect(listAuditsMock).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(connectionMock).not.toHaveBeenCalled();
  });

  // The cached read must not keep a failed read, so the click renders
  // fresh and the page reads Core again.
  it("renders a failed read fresh on the click", async () => {
    listAuditsMock
      .mockRejectedValueOnce(new Error("Core answered 503"))
      .mockResolvedValue(INDEX);

    const index = await loadSeoAuditIndex({});

    expect(connectionMock).toHaveBeenCalledOnce();
    expect(index).toEqual(INDEX);
  });

  // A Core 401 redirects to sign-in; the prefetch must carry it.
  it("keeps a sign-in redirect from the cached read", async () => {
    listAuditsMock.mockImplementation(async () => redirect("/signin"));

    await expect(loadSeoAuditIndex({})).rejects.toThrow("NEXT_REDIRECT");

    expect(connectionMock).not.toHaveBeenCalled();
  });
});
