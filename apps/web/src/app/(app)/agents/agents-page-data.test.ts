import { expectConsole } from "@sokosumi/utils/test-console";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn(async () => undefined);
const listCoworkersMock = vi.fn();
const getAllCoreAgentsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: { listCoworkers: listCoworkersMock },
}));
vi.mock("@/lib/agents/core-loaders", () => ({
  getAllCoreAgents: getAllCoreAgentsMock,
}));

const { loadAgentsCatalog, loadAgentsCoworkers } = await import(
  "./agents-page-data"
);

describe("agents page data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCoworkersMock.mockReset();
    getAllCoreAgentsMock.mockReset();
  });

  // connection() would drop the gallery from every link prefetch.
  it("reads both tiers without deferring to the request", async () => {
    listCoworkersMock.mockResolvedValue([{ id: "coworker-1" }]);
    getAllCoreAgentsMock.mockResolvedValue([{ id: "agent-1" }]);

    await expect(loadAgentsCoworkers()).resolves.toEqual([
      { id: "coworker-1" },
    ]);
    await expect(loadAgentsCatalog()).resolves.toEqual([{ id: "agent-1" }]);
    expect(connectionMock).not.toHaveBeenCalled();
  });

  // A failed read must not be kept in the prefetch, and a second failure on
  // the click must still render the page instead of its error boundary.
  it("renders a failed catalog read fresh, and empty when it fails again", async () => {
    expectConsole("warn", "[agents] agent catalog fetch failed");
    getAllCoreAgentsMock.mockRejectedValue(new Error("Core answered 503"));

    await expect(loadAgentsCatalog()).resolves.toEqual([]);
    expect(connectionMock).toHaveBeenCalledOnce();
  });

  it("renders an empty gallery when the coworkers fail twice", async () => {
    listCoworkersMock.mockRejectedValue(new Error("Core answered 503"));

    await expect(loadAgentsCoworkers()).resolves.toEqual([]);
    expect(connectionMock).toHaveBeenCalledOnce();
  });

  // A Core 401 redirects to sign-in; the prefetch must carry it.
  // A redirect on the click's own read must reach the page as well, instead
  // of turning into an empty gallery.
  it("keeps a sign-in redirect from the fresh read", async () => {
    listCoworkersMock
      .mockRejectedValueOnce(new Error("Core answered 503"))
      .mockImplementation(async () => redirect("/signin"));

    await expect(loadAgentsCoworkers()).rejects.toThrow("NEXT_REDIRECT");
    expect(connectionMock).toHaveBeenCalledOnce();
  });

  it("keeps a sign-in redirect from the cached read", async () => {
    listCoworkersMock.mockImplementation(async () => redirect("/signin"));

    await expect(loadAgentsCoworkers()).rejects.toThrow("NEXT_REDIRECT");
    expect(connectionMock).not.toHaveBeenCalled();
  });
});
