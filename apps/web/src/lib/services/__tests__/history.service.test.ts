import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const coreClientMock = {
  getHistory: vi.fn(),
};

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreClientMock,
}));

function buildHistoryItem() {
  return {
    kind: "task" as const,
    id: "task-1",
    title: "Test task",
    description: null,
    status: "READY" as const,
    updatedAt: new Date("2026-02-19T10:00:00.000Z"),
    archivedAt: null,
    credits: 2,
    projectId: null,
    coworkerId: null,
    owner: null,
  };
}

describe("history.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists history and forwards filters to the core client", async () => {
    const item = buildHistoryItem();
    coreClientMock.getHistory.mockResolvedValue({
      data: [item],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 50,
          nextCursor: "cursor-2",
        },
      },
    });

    const { historyService } = await import("../history.service");
    const result = await historyService.listHistory({
      cursor: "cursor-1",
      limit: 20,
      projectId: "null",
      q: "onboarding",
      scope: "workspace",
      status: ["READY", "completed"],
      types: ["task", "job"],
    });

    expect(coreClientMock.getHistory).toHaveBeenCalledWith({
      cursor: "cursor-1",
      limit: 20,
      projectId: "null",
      q: "onboarding",
      scope: "workspace",
      status: ["READY", "completed"],
      types: ["task", "job"],
    });
    expect(result).toEqual({
      history: [item],
      pagination: {
        cursor: null,
        limit: 20,
        total: 50,
        nextCursor: "cursor-2",
      },
    });
  });

  it("converts ISO string updatedAt values from core into Date objects", async () => {
    coreClientMock.getHistory.mockResolvedValue({
      data: [
        {
          ...buildHistoryItem(),
          updatedAt: "2026-02-19T10:00:00.000Z",
        },
      ],
    });

    const { historyService } = await import("../history.service");
    const result = await historyService.listHistory();

    expect(result.history[0]?.updatedAt).toEqual(
      new Date("2026-02-19T10:00:00.000Z"),
    );
  });

  it("converts ISO string archivedAt values from core into Date objects", async () => {
    coreClientMock.getHistory.mockResolvedValue({
      data: [
        {
          ...buildHistoryItem(),
          archivedAt: "2026-02-20T10:00:00.000Z",
        },
      ],
    });

    const { historyService } = await import("../history.service");
    const result = await historyService.listHistory();

    expect(result.history[0]?.archivedAt).toEqual(
      new Date("2026-02-20T10:00:00.000Z"),
    );
  });

  it("omits null cursor and returns null pagination when absent", async () => {
    const item = buildHistoryItem();
    coreClientMock.getHistory.mockResolvedValue({
      data: [item],
    });

    const { historyService } = await import("../history.service");
    const result = await historyService.listHistory({
      cursor: null,
      limit: 10,
      types: ["task", "job"],
    });

    expect(coreClientMock.getHistory).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 10,
      projectId: undefined,
      q: undefined,
      scope: undefined,
      status: undefined,
      types: ["task", "job"],
    });
    expect(result).toEqual({
      history: [item],
      pagination: null,
    });
  });
});
