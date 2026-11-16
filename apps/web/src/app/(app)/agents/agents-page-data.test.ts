import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn(async () => undefined);
const listCoworkersMock = vi.fn();
const getAllCoreAgentsMock = vi.fn();
const getCoreCategoriesMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: { listCoworkers: listCoworkersMock },
}));
vi.mock("@/lib/agents/core-loaders", () => ({
  getAllCoreAgents: getAllCoreAgentsMock,
  getCoreCategories: getCoreCategoriesMock,
}));

const { loadAgentsCatalog, loadAgentsCoworkers } = await import(
  "./agents-page-data"
);

describe("agents page data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCoworkersMock.mockReset();
    getAllCoreAgentsMock.mockReset();
    getCoreCategoriesMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  // connection() would drop the gallery from every link prefetch.
  it("reads both tiers without deferring to the request", async () => {
    listCoworkersMock.mockResolvedValue([{ id: "coworker-1" }]);
    getAllCoreAgentsMock.mockResolvedValue([{ id: "agent-1" }]);
    getCoreCategoriesMock.mockResolvedValue([]);

    await expect(loadAgentsCoworkers()).resolves.toEqual([
      { id: "coworker-1" },
    ]);
    await expect(loadAgentsCatalog()).resolves.toEqual([
      [{ id: "agent-1" }],
      [],
    ]);
    expect(connectionMock).not.toHaveBeenCalled();
  });

  // A failed read must not be kept in the prefetch, and a second failure on
  // the click must still render the page instead of its error boundary.
  it("renders a failed catalog read fresh, and empty when it fails again", async () => {
    getAllCoreAgentsMock.mockRejectedValue(new Error("Core answered 503"));
    getCoreCategoriesMock.mockResolvedValue([{ id: "category-1" }]);

    await expect(loadAgentsCatalog()).resolves.toEqual([
      [],
      [{ id: "category-1" }],
    ]);
    expect(connectionMock).toHaveBeenCalledOnce();
  });

  it("renders an empty gallery when the coworkers fail twice", async () => {
    listCoworkersMock.mockRejectedValue(new Error("Core answered 503"));

    await expect(loadAgentsCoworkers()).resolves.toEqual([]);
    expect(connectionMock).toHaveBeenCalledOnce();
  });

  // A Core 401 redirects to sign-in; the prefetch must carry it.
  it("keeps a sign-in redirect from the cached read", async () => {
    listCoworkersMock.mockImplementation(async () => redirect("/signin"));

    await expect(loadAgentsCoworkers()).rejects.toThrow("NEXT_REDIRECT");
    expect(connectionMock).not.toHaveBeenCalled();
  });
});
