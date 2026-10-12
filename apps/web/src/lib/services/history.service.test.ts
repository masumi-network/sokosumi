import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const coreClientMock = {
  getTransactions: vi.fn(),
};

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreClientMock,
}));

function buildHistoryItem() {
  return {
    kind: "task" as const,
    id: "tx-1",
    title: "Test task",
    description: null,
    consumedAt: new Date("2026-02-19T10:00:00.000Z"),
    credits: 2,
    projectId: null,
    owner: null,
    taskId: "task-1",
    taskEventId: "event-1",
  };
}

describe("history.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists history and forwards filters to the core client", async () => {
    const item = buildHistoryItem();
    coreClientMock.getTransactions.mockResolvedValue({
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

    const { historyService } = await import("./history.service");
    const result = await historyService.listHistory({
      cursor: "cursor-1",
      limit: 20,
      projectId: "null",
      q: "onboarding",
      scope: "workspace",
      types: ["task", "job"],
    });

    expect(coreClientMock.getTransactions).toHaveBeenCalledWith({
      cursor: "cursor-1",
      limit: 20,
      projectId: "null",
      q: "onboarding",
      scope: "workspace",
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

  it("returns consumedAt Dates from the core client as-is", async () => {
    const item = buildHistoryItem();
    coreClientMock.getTransactions.mockResolvedValue({
      data: [item],
    });

    const { historyService } = await import("./history.service");
    const result = await historyService.listHistory();

    expect(result.history[0]?.consumedAt).toBe(item.consumedAt);
    expect(result.history[0]?.consumedAt).toBeInstanceOf(Date);
  });

  it("omits null cursor and returns null pagination when absent", async () => {
    const item = buildHistoryItem();
    coreClientMock.getTransactions.mockResolvedValue({
      data: [item],
    });

    const { historyService } = await import("./history.service");
    const result = await historyService.listHistory({
      cursor: null,
      limit: 10,
      types: ["task", "job"],
    });

    expect(coreClientMock.getTransactions).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 10,
      projectId: undefined,
      q: undefined,
      scope: undefined,
      types: ["task", "job"],
    });
    expect(result).toEqual({
      history: [item],
      pagination: null,
    });
  });
});
