import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const coreClientMock = {
  getCoworkers: vi.fn(),
};

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreClientMock,
}));

describe("coworker.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns coworkers from core client response data", async () => {
    coreClientMock.getCoworkers.mockResolvedValue({
      data: [
        {
          id: "cow-1",
          slug: "hannah",
          name: "Hannah",
        },
      ],
    });

    const { coworkerService } = await import("./coworker.service");
    const result = await coworkerService.listCoworkers();

    expect(coreClientMock.getCoworkers).toHaveBeenCalledTimes(1);
    expect(coreClientMock.getCoworkers).toHaveBeenCalledWith({
      scope: "available",
    });
    expect(result).toEqual([
      {
        id: "cow-1",
        slug: "hannah",
        name: "Hannah",
      },
    ]);
  });

  it("returns empty list when core client data is missing", async () => {
    coreClientMock.getCoworkers.mockResolvedValue({ data: null });

    const { coworkerService } = await import("./coworker.service");
    const result = await coworkerService.listCoworkers();

    expect(result).toEqual([]);
  });

  it("returns all coworkers without UI slug filtering", async () => {
    coreClientMock.getCoworkers.mockResolvedValue({
      data: [
        {
          id: "cow-1",
          slug: "hannah",
          name: "Hannah",
        },
        {
          id: "cow-2",
          slug: "Hermes",
          name: "Hermes",
        },
      ],
    });

    const { coworkerService } = await import("./coworker.service");
    const result = await coworkerService.listCoworkers();

    expect(result).toEqual([
      {
        id: "cow-1",
        slug: "hannah",
        name: "Hannah",
      },
      {
        id: "cow-2",
        slug: "Hermes",
        name: "Hermes",
      },
    ]);
  });

  it("forwards the capability filter when provided", async () => {
    coreClientMock.getCoworkers.mockResolvedValue({
      data: [],
    });

    const { coworkerService } = await import("./coworker.service");
    await coworkerService.listCoworkers("tasks");

    expect(coreClientMock.getCoworkers).toHaveBeenCalledWith({
      scope: "available",
      capability: ["tasks"],
    });
  });

  it("filters chat coworkers to active runnable entries", async () => {
    const runnableChatCoworker = {
      id: "cow-1",
      slug: "hannah",
      name: "Hannah",
      archivedAt: null,
      isWhitelisted: true,
      baseURL: "https://responses.example.com/v1",
      capabilities: ["chat"],
    };
    // scope=available already encodes whitelist ∪ GRANTED. Early-access
    // coworkers (isWhitelisted=false, workspace GRANTED) must stay pickable
    // for channel roster / DMs — matching Core validateChatCoworkerIds.
    const earlyAccessChatCoworker = {
      id: "cow-4",
      slug: "noodles",
      name: "Noodles",
      archivedAt: null,
      isWhitelisted: false,
      baseURL: "https://responses.example.com/v1",
      capabilities: ["chat"],
    };

    coreClientMock.getCoworkers.mockResolvedValue({
      data: [
        runnableChatCoworker,
        {
          id: "cow-2",
          slug: "no-base-url",
          name: "No base URL",
          archivedAt: null,
          isWhitelisted: true,
          baseURL: null,
          capabilities: ["chat"],
        },
        {
          id: "cow-3",
          slug: "archived",
          name: "Archived",
          archivedAt: new Date("2026-01-01T00:00:00.000Z"),
          isWhitelisted: true,
          baseURL: "https://responses.example.com/v1",
          capabilities: ["chat"],
        },
        earlyAccessChatCoworker,
      ],
    });

    const { coworkerService } = await import("./coworker.service");
    const result = await coworkerService.listCoworkers("chat");

    expect(coreClientMock.getCoworkers).toHaveBeenCalledWith({
      scope: "available",
      capability: ["chat"],
    });
    expect(result).toEqual([runnableChatCoworker, earlyAccessChatCoworker]);
  });
});
