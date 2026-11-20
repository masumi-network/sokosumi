import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn(async () => undefined);
const getProjectByIdMock = vi.fn();
const listAccountsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: getProjectByIdMock },
}));
vi.mock("@/lib/services/ads.service", () => ({
  adsService: { listAccounts: listAccountsMock },
}));

const { loadAdsPageScope } = await import("./ads-page-data");

const PROJECT = { id: "project-1", cmo: false };
const ACCOUNTS = [{ id: "account-1" }];

describe("loadAdsPageScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectByIdMock.mockReset();
    listAccountsMock.mockReset();
    listAccountsMock.mockResolvedValue(ACCOUNTS);
  });

  // connection() would drop the page from every link prefetch.
  it("reads the page without deferring to the request", async () => {
    getProjectByIdMock.mockResolvedValue(PROJECT);

    const scope = await loadAdsPageScope("project-1");

    expect(scope).toEqual({ project: PROJECT, accounts: ACCOUNTS });
    expect(connectionMock).not.toHaveBeenCalled();
  });

  // The cached read must not keep a failed read, so the click renders
  // fresh and the page reads Core again.
  it("renders a failed read fresh on the click", async () => {
    getProjectByIdMock
      .mockRejectedValueOnce(new Error("Core answered 503"))
      .mockResolvedValue(PROJECT);

    const scope = await loadAdsPageScope("project-1");

    expect(connectionMock).toHaveBeenCalledOnce();
    expect(scope).toEqual({ project: PROJECT, accounts: ACCOUNTS });
  });

  // A Core 401 redirects to sign-in; the prefetch must carry it.
  it("keeps a sign-in redirect from the cached read", async () => {
    getProjectByIdMock.mockImplementation(async () => redirect("/signin"));

    await expect(loadAdsPageScope("project-1")).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(connectionMock).not.toHaveBeenCalled();
  });
});
