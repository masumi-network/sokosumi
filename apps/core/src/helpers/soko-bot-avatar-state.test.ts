import { describe, expect, it } from "vitest";

import {
  type AvatarStateInput,
  avatarFields,
  buildAvatarView,
  deriveAvatarState,
} from "@/helpers/soko-bot-avatar-state";

const NOW = new Date("2026-10-29T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

function input(overrides: Partial<AvatarStateInput> = {}): AvatarStateInput {
  return {
    status: "IDLE",
    archivedAt: null,
    adminPausedAt: null,
    latestTurn: null,
    hasOpenDecision: false,
    now: NOW,
    ...overrides,
  };
}

describe("deriveAvatarState", () => {
  it("is idle when nothing is going on", () => {
    expect(deriveAvatarState(input())).toBe("idle");
  });

  it.each([
    ["QUEUED", "thinking"],
    ["STARTING", "thinking"],
    ["RUNNING", "working"],
    ["CANCEL_REQUESTED", "working"],
  ])("shows a %s turn as %s", (status, expected) => {
    expect(
      deriveAvatarState(input({ latestTurn: { status, completedAt: null } })),
    ).toBe(expected);
  });

  it("shows done for ten minutes after a turn completes, then idle", () => {
    const done = (minutes: number) =>
      deriveAvatarState(
        input({
          latestTurn: { status: "COMPLETED", completedAt: minutesAgo(minutes) },
        }),
      );

    expect(done(0)).toBe("done");
    expect(done(10)).toBe("done");
    expect(done(10.1)).toBe("idle");
  });

  it.each(["FAILED", "CANCELLED"])(
    "leaves a %s turn idle: the error UI says the rest",
    (status) => {
      expect(
        deriveAvatarState(
          input({ latestTurn: { status, completedAt: minutesAgo(1) } }),
        ),
      ).toBe("idle");
    },
  );

  it("leaves an errored bot idle", () => {
    expect(deriveAvatarState(input({ status: "ERROR" }))).toBe("idle");
  });

  it("needs you whenever a decision is open", () => {
    expect(deriveAvatarState(input({ hasOpenDecision: true }))).toBe(
      "needs_you",
    );
  });

  it("puts the open decision above a running turn", () => {
    expect(
      deriveAvatarState(
        input({
          hasOpenDecision: true,
          latestTurn: { status: "RUNNING", completedAt: null },
        }),
      ),
    ).toBe("needs_you");
  });

  it.each([
    ["a paused bot", { status: "PAUSED" }],
    ["an archived bot", { archivedAt: minutesAgo(5) }],
    ["an admin-paused bot", { adminPausedAt: minutesAgo(5) }],
    ["Soko Bots switched off", { availabilityDisabled: true }],
  ])("shows %s as offline, above everything else", (_name, overrides) => {
    expect(
      deriveAvatarState(
        input({
          ...overrides,
          hasOpenDecision: true,
          latestTurn: { status: "RUNNING", completedAt: null },
        }),
      ),
    ).toBe("offline");
  });
});

describe("buildAvatarView", () => {
  const crafted = {
    styleId: "crafted-desk",
    styleVersion: 1,
    imageUrl: "https://blob.test/idle.webp",
    renders: [
      {
        state: "IDLE",
        stillUrl: "https://blob.test/idle.webp",
        loopUrl: "https://blob.test/idle-320.webp",
        loopLargeUrl: "https://blob.test/idle-560.webp",
      },
      {
        state: "THINKING",
        stillUrl: "https://blob.test/thinking.webp",
        loopUrl: null,
        loopLargeUrl: null,
      },
      // A state whose still is not drawn yet has nothing to show.
      { state: "WORKING", stillUrl: null, loopUrl: null, loopLargeUrl: null },
    ],
  };

  it("lists every state, with loops only where they are ready", () => {
    expect(buildAvatarView(crafted, crafted.imageUrl)).toEqual({
      styleId: "crafted-desk",
      styleVersion: 1,
      stillUrl: "https://blob.test/idle.webp",
      states: {
        idle: {
          stillUrl: "https://blob.test/idle.webp",
          loopUrl: "https://blob.test/idle-320.webp",
          loopLargeUrl: "https://blob.test/idle-560.webp",
        },
        thinking: {
          stillUrl: "https://blob.test/thinking.webp",
          loopUrl: null,
          loopLargeUrl: null,
        },
        working: null,
        done: null,
        needs_you: null,
        offline: null,
      },
    });
  });

  it("uses the look itself as the still before any render row exists", () => {
    expect(
      buildAvatarView({ ...crafted, renders: [] }, crafted.imageUrl)?.stillUrl,
    ).toBe("https://blob.test/idle.webp");
  });

  it("gives a legacy mascot its one image and no states", () => {
    expect(buildAvatarView(null, "https://blob.test/mascot.png")).toEqual({
      styleId: "mascot",
      styleVersion: 1,
      stillUrl: "https://blob.test/mascot.png",
      states: {
        idle: null,
        thinking: null,
        working: null,
        done: null,
        needs_you: null,
        offline: null,
      },
    });
  });

  it("has no avatar for a bot with no image: the client draws the orb", () => {
    expect(buildAvatarView(null, null)).toBeNull();
  });
});

describe("avatarFields", () => {
  it("reads the latest turn and open decisions off a loaded bot", () => {
    const fields = avatarFields({
      status: "RUNNING",
      archivedAt: null,
      adminPausedAt: null,
      avatarImageUrl: "https://blob.test/mascot.png",
      avatar: null,
      turns: [{ status: "RUNNING", completedAt: null }],
      pendingDecisions: [{ id: "decision-1" }],
      now: NOW,
    });

    // A decision during a run: the bot is waiting on you.
    expect(fields.avatarState).toBe("needs_you");
    expect(fields.avatar?.stillUrl).toBe("https://blob.test/mascot.png");
  });
});
