import { describe, expect, it } from "vitest";
import {
  compactItem,
  memorySections,
  messageSources,
  sokoBotPacketKind,
  sokoBotPacketPlan,
} from "./context-organizer";

const chat = (route: string, signals?: Record<string, number>) =>
  ({ route, signals }) as Parameters<typeof sokoBotPacketPlan>[1];

describe("sokoBotPacketKind", () => {
  it("takes the kind from Core's ids, never the message", () => {
    expect(sokoBotPacketKind({ source: "CHAT", scheduleKey: null })).toBe(
      "chat",
    );
    expect(sokoBotPacketKind({ source: "INGEST", scheduleKey: null })).toBe(
      "ingest",
    );
    expect(sokoBotPacketKind({ source: "EVENT", scheduleKey: null })).toBe(
      "event",
    );
    expect(
      sokoBotPacketKind({ source: "SCHEDULE", scheduleKey: "standup" }),
    ).toBe("rhythm");
    expect(
      sokoBotPacketKind({ source: "SCHEDULE", scheduleKey: "dreaming" }),
    ).toBe("dreaming");
    expect(
      sokoBotPacketKind({ source: "SCHEDULE", scheduleKey: "meeting-prep" }),
    ).toBe("meeting-prep");
    expect(sokoBotPacketKind({ source: "SCHEDULE", scheduleKey: null })).toBe(
      "schedule",
    );
  });
});

describe("sokoBotPacketPlan", () => {
  it("always shows what waits on the owner, except where the model sees no packet", () => {
    for (const kind of ["chat", "event", "rhythm", "ingest"] as const)
      expect(
        sokoBotPacketPlan(kind, chat("DIRECT_RESPONSE")).waitingTasks,
      ).toBeGreaterThan(0);
    expect(sokoBotPacketPlan("meeting-prep", chat("DIRECT_RESPONSE"))).toEqual(
      expect.objectContaining({ tasks: 0, waitingTasks: 0, recentTurns: 0 }),
    );
  });

  it("adds the board for work routes and for a message about Tasks", () => {
    expect(sokoBotPacketPlan("chat", chat("DIRECT_RESPONSE")).tasks).toBe(0);
    expect(sokoBotPacketPlan("chat", chat("MANAGE_WORK")).tasks).toBe(16);
    expect(
      sokoBotPacketPlan("chat", chat("DIRECT_RESPONSE", { aboutTasks: 0.8 }))
        .tasks,
    ).toBe(16);
  });

  it("adds Coworkers to assign and the marketplace to hire", () => {
    expect(sokoBotPacketPlan("chat", chat("MANAGE_WORK")).coworkers).toBe(0);
    expect(sokoBotPacketPlan("chat", chat("DELEGATE_TASK")).coworkers).toBe(12);
    expect(sokoBotPacketPlan("chat", chat("DELEGATE_TASK")).agents).toBe(0);
    expect(sokoBotPacketPlan("chat", chat("HIRE_AGENT")).agents).toBe(24);
  });

  it("carries more of the conversation when the message points back at it", () => {
    expect(sokoBotPacketPlan("chat", chat("CLARIFY")).recentTurns).toBe(8);
    expect(
      sokoBotPacketPlan("chat", chat("CLARIFY", { refersToEarlier: 0.9 }))
        .recentTurns,
    ).toBe(12);
  });

  it("gives a rhythm no board: its prompt lists what it reports on", () => {
    expect(sokoBotPacketPlan("rhythm", chat("DELEGATE_TASK"))).toEqual(
      expect.objectContaining({ tasks: 0, coworkers: 0, agents: 0 }),
    );
  });
});

describe("compactItem", () => {
  it("drops trust labels and fields that say nothing", () => {
    expect(
      compactItem({
        id: "t1",
        priority: null,
        requiredReference: false,
        blockedBy: [],
        blockersOmitted: 0,
        trust: "untrusted-data",
        lastEvent: { status: "RUNNING", summary: null },
      }),
    ).toEqual({ id: "t1", lastEvent: { status: "RUNNING" } });
  });
});

describe("memorySections", () => {
  it("counts the entries of each section", () => {
    expect(
      memorySections(
        "# Memory\n\n## Preferences\n- short answers\n- German\n\n## Follow-ups\n",
      ),
    ).toEqual({ Preferences: 2, "Follow-ups": 0 });
  });
});

describe("messageSources", () => {
  it("lists chats for every turn", () => {
    expect(
      messageSources({ providers: [], xDms: false }).map((source) => source.id),
    ).toEqual(["chats"]);
  });

  it("adds X direct messages only when this turn may read them and X is connected", () => {
    const ids = (providers: string[], xDms: boolean) =>
      messageSources({ providers, xDms }).map((source) => source.id);
    expect(ids(["twitter"], true)).toEqual(["chats", "x-dms"]);
    // A shared room, a teammate, or a version without X DMs: not offered.
    expect(ids(["twitter"], false)).toEqual(["chats"]);
    expect(ids(["gmail"], true)).toEqual(["chats"]);
  });
});
