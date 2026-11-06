import { describe, expect, it } from "vitest";

import type {
  ChatTurn,
  ChatTurnEvent,
  SokoBotChatState,
} from "@/lib/soko-bot/chat-state";

import {
  orbStateForTurn,
  orderedTurns,
  progressChipsForTurn,
  turnKind,
} from "../timeline";

function event(
  sequence: number,
  type: string,
  toolName: string | null = null,
): ChatTurnEvent {
  return {
    id: `e${sequence}`,
    sequence,
    type,
    summary: null,
    toolName,
    toolStatus: null,
    durationMs: null,
    createdAt: new Date(2026, 0, 1, 0, 0, sequence).toISOString(),
    payload: null,
  };
}

function turn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: "t1",
    source: "CHAT",
    status: "COMPLETED",
    route: "DIRECT_RESPONSE",
    userMessage: "hi",
    finalAnswer: "hello",
    errorKind: null,
    errorDetail: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    events: [],
    delegations: [],
    decisions: [],
    requestedBy: null,
    chatRoom: null,
    qualityScore: null,
    ...overrides,
  };
}

function state(overrides: Partial<SokoBotChatState> = {}): SokoBotChatState {
  return {
    bot: {
      id: "bot",
      userId: "user",
      viewerCanManage: true,
      name: "Atlas",
      avatarSeed: null,
      avatarImageUrl: null,
      avatarState: "idle",
      avatar: null,
      versionId: null,
      followWholeBoard: false,
      mailAutoRead: false,
      ingestTimezone: "Europe/Berlin",
      proactivePaused: false,
      proactiveDailyLimit: 20,
      status: "IDLE",
      memoryVersion: 0,
      memory: null,
      lastActivityAt: null,
      schedules: [],
      pendingDecisions: [],
    },
    turns: [],
    ...overrides,
  };
}

describe("progressChipsForTurn", () => {
  it("opens a chip per requested action and closes it on the result", () => {
    const chips = progressChipsForTurn(
      turn({
        events: [
          event(1, "reasoning.appended"),
          event(2, "actions.requested", "find_coworkers"),
          event(3, "action.result", "find_coworkers"),
          event(4, "actions.requested", "create_task"),
        ],
      }),
    );
    expect(chips).toEqual([
      { id: "find_coworkers1", toolName: "find_coworkers", done: true },
      { id: "create_task2", toolName: "create_task", done: false },
    ]);
  });

  it("closes the oldest open chip when a result carries no tool name", () => {
    const chips = progressChipsForTurn(
      turn({
        events: [
          event(1, "actions.requested", "create_task"),
          event(2, "action.result"),
        ],
      }),
    );
    expect(chips[0]?.done).toBe(true);
  });
});

describe("orbStateForTurn", () => {
  it("maps the newest event to an orb activity", () => {
    expect(orbStateForTurn(turn({ events: [] }))).toBe("solving");
    expect(
      orbStateForTurn(
        turn({ events: [event(1, "actions.requested", "find_agents")] }),
      ),
    ).toBe("searching");
    expect(
      orbStateForTurn(turn({ events: [event(1, "message.appended")] })),
    ).toBe("composing");
  });
});

describe("state helpers", () => {
  it("orders turns oldest first", () => {
    const s = state({
      turns: [
        turn({ id: "b", createdAt: "2026-01-02T00:00:00.000Z" }),
        turn({
          id: "a",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "RUNNING",
        }),
      ],
    });
    expect(orderedTurns(s).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("labels scheduled and retried turns", () => {
    expect(turnKind(turn({ source: "SCHEDULE" }))).toBe("scheduled");
    expect(turnKind(turn({ source: "ADMIN_RETRY" }))).toBe("retry");
    expect(turnKind(turn())).toBeNull();
  });
});
