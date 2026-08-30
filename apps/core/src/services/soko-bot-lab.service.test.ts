import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  botFindFirstMock,
  delegationFindFirstMock,
  delegationUpdateManyMock,
  taskFindFirstMock,
  taskUpdateMock,
  taskEventCreateMock,
  startTurnMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  delegationFindFirstMock: vi.fn(),
  delegationUpdateManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  taskEventCreateMock: vi.fn(),
  startTurnMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findFirst: botFindFirstMock },
    sokoBotDelegation: { findFirst: delegationFindFirstMock },
  },
}));

vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: async (run: (tx: unknown) => unknown) =>
    await run({
      task: { findFirst: taskFindFirstMock, update: taskUpdateMock },
      taskEvent: { create: taskEventCreateMock },
      sokoBotDelegation: { updateMany: delegationUpdateManyMock },
    }),
}));

vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { startTurn: startTurnMock },
}));

import { simulateSokoBotTaskEvent } from "@/services/soko-bot-lab.service";

const INPUT = {
  userId: "user_1",
  workspaceId: "ws_1",
  status: "FAILED" as const,
  comment: "The upstream export is empty.",
};

describe("simulateSokoBotTaskEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    botFindFirstMock.mockResolvedValue({ id: "bot_1" });
    delegationFindFirstMock.mockResolvedValue({
      id: "del_1",
      taskId: "01960001-0001-7001-8001-000000000001",
    });
    taskFindFirstMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000001",
      name: "Export the ledger",
      status: "RUNNING",
    });
    taskUpdateMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000001",
      name: "Export the ledger",
      status: "FAILED",
    });
    taskEventCreateMock.mockResolvedValue({});
    delegationUpdateManyMock.mockResolvedValue({ count: 1 });
    startTurnMock.mockResolvedValue({ turnId: "turn_1" });
  });

  it("starts the turn itself and hands back its id", async () => {
    // The lab used to wait on the one-minute events cron and then hunt for a
    // turn whose text mentioned the task. Every reason a wake can be withheld
    // looked the same from there: nothing, for five minutes.
    const result = await simulateSokoBotTaskEvent(INPUT);

    expect(result.turnId).toBe("turn_1");
    expect(startTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: "EVENT" }),
    );
  });

  it("keeps a lab run out of the owner's proactive allowance", async () => {
    // The allowance is for work the bot decided to do by itself. The cron
    // started these with an `event:` id, so running the lab burned the budget
    // and the scenarios silently stopped waking anything after the 20th.
    await simulateSokoBotTaskEvent(INPUT);

    const { clientTurnId } = startTurnMock.mock.calls[0]![0];
    expect(clientTurnId).toMatch(/^lab:/);
  });

  it("tells the bot what actually changed", async () => {
    await simulateSokoBotTaskEvent(INPUT);

    const { message } = startTurnMock.mock.calls[0]![0];
    expect(message).toContain("01960001-0001-7001-8001-000000000001");
    expect(message).toContain("FAILED");
    expect(message).toContain("The upstream export is empty.");
  });

  it("marks the delegation seen so the cron does not wake it twice", async () => {
    await simulateSokoBotTaskEvent(INPUT);

    expect(delegationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastSeenStatus: "FAILED" } }),
    );
  });
});
