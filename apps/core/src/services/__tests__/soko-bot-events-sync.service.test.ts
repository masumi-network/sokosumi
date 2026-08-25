import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  delegationFindManyMock,
  delegationUpdateMock,
  getEnvMock,
  reconcileTurnMock,
  startTurnMock,
} = vi.hoisted(() => ({
  delegationFindManyMock: vi.fn(),
  delegationUpdateMock: vi.fn(),
  getEnvMock: vi.fn(),
  reconcileTurnMock: vi.fn(),
  startTurnMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotDelegation: {
      findMany: delegationFindManyMock,
      update: delegationUpdateMock,
    },
  },
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class SokoBotBusyError extends Error {},
  sokoBotControlPlane: {
    reconcileTurn: reconcileTurnMock,
    startTurn: startTurnMock,
  },
}));

import { SokoBotBusyError } from "@/services/soko-bot-control-plane.service";

import {
  buildEventMessage,
  SokoBotEventsSyncService,
} from "../soko-bot-events-sync.service";

const turn = { sokoBotId: "bot_1", userId: "user_1", workspaceId: "ws_1" };
const input = {
  abortSignal: new AbortController().signal,
  shouldContinue: () => true,
};

function taskDelegation(
  id: string,
  lastSeenStatus: string | null,
  status: string,
) {
  return {
    id,
    kind: "TASK",
    lastSeenStatus,
    task: { id: `task_${id}`, name: `Task ${id}`, status, events: [] },
    job: null,
    turn,
  };
}

describe("SokoBotEventsSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: true });
    delegationUpdateMock.mockResolvedValue({});
    reconcileTurnMock.mockResolvedValue(undefined);
    startTurnMock.mockResolvedValue({
      turnId: "turn_event",
      status: "RUNNING",
      reconciliationLeaseToken: "lease",
    });
  });

  it("wakes the bot once for all changed delegations and marks them seen", async () => {
    delegationFindManyMock.mockResolvedValue([
      taskDelegation("a", "READY", "COMPLETED"),
      taskDelegation("b", "DRAFT", "DRAFT"),
      taskDelegation("c", "READY", "FAILED"),
    ]);
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result).toEqual({ scanned: 3, woken: 1, deferred: 0, failed: 0 });
    expect(startTurnMock).toHaveBeenCalledTimes(1);
    const call = startTurnMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      userId: "user_1",
      workspaceId: "ws_1",
      source: "EVENT",
    });
    expect(call.message).toContain(
      'Task "Task a" (id task_a) is now COMPLETED (was READY)',
    );
    expect(call.message).toContain("is now FAILED");
    expect(delegationUpdateMock).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { lastSeenStatus: "COMPLETED" },
    });
    expect(reconcileTurnMock).toHaveBeenCalledWith(
      "turn_event",
      input.abortSignal,
      "lease",
    );
  });

  it("baselines first observations and silent statuses without waking", async () => {
    delegationFindManyMock.mockResolvedValue([
      taskDelegation("new", null, "COMPLETED"),
      taskDelegation("running", "READY", "RUNNING"),
    ]);
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result.woken).toBe(0);
    expect(startTurnMock).not.toHaveBeenCalled();
    expect(delegationUpdateMock).toHaveBeenCalledTimes(2);
  });

  it("leaves the change unseen when the bot is busy so the next tick retries", async () => {
    delegationFindManyMock.mockResolvedValue([
      taskDelegation("a", "READY", "COMPLETED"),
    ]);
    startTurnMock.mockRejectedValue(new SokoBotBusyError("busy"));
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );

    expect(result).toEqual({ scanned: 1, woken: 0, deferred: 1, failed: 0 });
    expect(delegationUpdateMock).not.toHaveBeenCalled();
  });

  it("wakes on job completion via the latest job event", async () => {
    delegationFindManyMock.mockResolvedValue([
      {
        id: "j",
        kind: "JOB",
        lastSeenStatus: "RUNNING",
        task: null,
        job: { id: "job_1", name: null, events: [{ status: "COMPLETED" }] },
        turn,
      },
    ]);
    await new SokoBotEventsSyncService().syncDelegatedWork(input);
    expect(startTurnMock.mock.calls[0]?.[0].message).toContain(
      'Job "Agent job" (id job_1) is now COMPLETED',
    );
  });

  it("does nothing while Soko Bot is disabled", async () => {
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: false });
    const result = await new SokoBotEventsSyncService().syncDelegatedWork(
      input,
    );
    expect(result.scanned).toBe(0);
    expect(delegationFindManyMock).not.toHaveBeenCalled();
  });

  it("formats the wake-up message as a checklist", () => {
    const message = buildEventMessage([
      {
        delegationId: "d",
        kind: "TASK",
        entityId: "t1",
        name: "Brief",
        from: null,
        to: "COMPLETED",
        note: null,
      },
    ]);
    expect(
      message.startsWith(
        'Delegated work changed status:\n- Task "Brief" (id t1) is now COMPLETED.',
      ),
    ).toBe(true);
  });
});
