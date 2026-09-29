import { describe, expect, it } from "vitest";

import {
  applyTypingEvent,
  liveTypistIds,
  nextTypingPublishAction,
  TYPING_EXPIRY_MS,
  TYPING_HEARTBEAT_THROTTLE_MS,
  type TypingSet,
} from "./room-typing-model";

const EMPTY: TypingSet = [];
const SELF = "user_me";

function started(userId: string, atMs: number) {
  return { userId, state: "started" as const, atMs };
}

function stopped(userId: string, atMs: number) {
  return { userId, state: "stopped" as const, atMs };
}

describe("liveTypistIds", () => {
  it("names nobody in a quiet room", () => {
    expect(liveTypistIds(EMPTY, 0)).toEqual([]);
  });

  it("names a teammate who started typing", () => {
    const set = applyTypingEvent(EMPTY, started("user_pat", 1_000), SELF);

    expect(liveTypistIds(set, 1_000)).toEqual(["user_pat"]);
  });

  it("names two typists in the order they started", () => {
    let set = applyTypingEvent(EMPTY, started("user_pat", 1_000), SELF);
    set = applyTypingEvent(set, started("user_andreas", 2_000), SELF);

    expect(liveTypistIds(set, 2_000)).toEqual(["user_pat", "user_andreas"]);
  });

  it("keeps start order when an earlier typist stops and a later one remains", () => {
    let set = applyTypingEvent(EMPTY, started("user_pat", 1_000), SELF);
    set = applyTypingEvent(set, started("user_andreas", 2_000), SELF);
    set = applyTypingEvent(set, started("user_kim", 3_000), SELF);
    set = applyTypingEvent(set, stopped("user_andreas", 4_000), SELF);

    expect(liveTypistIds(set, 4_000)).toEqual(["user_pat", "user_kim"]);
  });

  it("drops a typist who has gone quiet for the expiry window", () => {
    const set = applyTypingEvent(EMPTY, started("user_pat", 1_000), SELF);

    expect(liveTypistIds(set, 1_000 + TYPING_EXPIRY_MS - 1)).toEqual([
      "user_pat",
    ]);
    expect(liveTypistIds(set, 1_000 + TYPING_EXPIRY_MS)).toEqual([]);
  });

  it("keeps a slow typist alive across heartbeats", () => {
    let set = applyTypingEvent(EMPTY, started("user_pat", 1_000), SELF);
    set = applyTypingEvent(set, started("user_pat", 11_000), SELF);

    expect(liveTypistIds(set, 11_000 + TYPING_EXPIRY_MS - 1)).toEqual([
      "user_pat",
    ]);
  });

  it("holds a heartbeating typist's place in the order", () => {
    let set = applyTypingEvent(EMPTY, started("user_pat", 1_000), SELF);
    set = applyTypingEvent(set, started("user_andreas", 2_000), SELF);
    set = applyTypingEvent(set, started("user_pat", 3_000), SELF);

    expect(liveTypistIds(set, 3_000)).toEqual(["user_pat", "user_andreas"]);
  });
});

describe("applyTypingEvent", () => {
  it("never records yourself, so you do not watch yourself type", () => {
    const set = applyTypingEvent(EMPTY, started(SELF, 1_000), SELF);

    expect(liveTypistIds(set, 1_000)).toEqual([]);
  });

  it("counts one person typing on two devices as one typist", () => {
    let set = applyTypingEvent(EMPTY, started("user_pat", 1_000), SELF);
    set = applyTypingEvent(set, started("user_pat", 1_500), SELF);

    expect(liveTypistIds(set, 1_500)).toEqual(["user_pat"]);
  });

  it("clears a typist as soon as they stop", () => {
    let set = applyTypingEvent(EMPTY, started("user_pat", 1_000), SELF);
    set = applyTypingEvent(set, stopped("user_pat", 2_000), SELF);

    expect(liveTypistIds(set, 2_000)).toEqual([]);
  });

  it("sends a typist who went quiet and came back to the end of the line", () => {
    // Pat goes quiet and expires; Kim starts while Pat is away. When Pat
    // types again they are starting afresh, so Kim — who has been typing the
    // whole time — must still be named first.
    let set = applyTypingEvent(EMPTY, started("user_pat", 1_000), SELF);
    set = applyTypingEvent(set, started("user_kim", 6_000), SELF);
    const afterPatExpired = 1_000 + TYPING_EXPIRY_MS + 1;
    set = applyTypingEvent(set, started("user_pat", afterPatExpired), SELF);

    expect(liveTypistIds(set, afterPatExpired)).toEqual([
      "user_kim",
      "user_pat",
    ]);
  });

  it("does not reorder a typist who merely paused inside the window", () => {
    let set = applyTypingEvent(EMPTY, started("user_pat", 1_000), SELF);
    set = applyTypingEvent(set, started("user_kim", 6_000), SELF);
    set = applyTypingEvent(set, started("user_pat", 10_000), SELF);

    expect(liveTypistIds(set, 10_000)).toEqual(["user_pat", "user_kim"]);
  });

  it("ignores a stop for somebody who was not typing", () => {
    const set = applyTypingEvent(EMPTY, stopped("user_ghost", 1_000), SELF);

    expect(liveTypistIds(set, 1_000)).toEqual([]);
  });
});

describe("nextTypingPublishAction", () => {
  it("announces the first keystroke immediately", () => {
    expect(
      nextTypingPublishAction({
        composerHasText: true,
        startedPublishedAtMs: null,
        nowMs: 1_000,
      }),
    ).toBe("start");
  });

  it("stays quiet while still inside the throttle window", () => {
    expect(
      nextTypingPublishAction({
        composerHasText: true,
        startedPublishedAtMs: 1_000,
        nowMs: 1_000 + TYPING_HEARTBEAT_THROTTLE_MS - 1,
      }),
    ).toBe("none");
  });

  it("heartbeats once the throttle window is up", () => {
    expect(
      nextTypingPublishAction({
        composerHasText: true,
        startedPublishedAtMs: 1_000,
        nowMs: 1_000 + TYPING_HEARTBEAT_THROTTLE_MS,
      }),
    ).toBe("start");
  });

  it("heartbeats before teammates would expire you", () => {
    expect(TYPING_HEARTBEAT_THROTTLE_MS).toBeLessThan(TYPING_EXPIRY_MS);
  });

  it("stops when the composer is cleared back to empty", () => {
    expect(
      nextTypingPublishAction({
        composerHasText: false,
        startedPublishedAtMs: 1_000,
        nowMs: 2_000,
      }),
    ).toBe("stop");
  });

  it("says nothing about an empty composer nobody was told about", () => {
    expect(
      nextTypingPublishAction({
        composerHasText: false,
        startedPublishedAtMs: null,
        nowMs: 2_000,
      }),
    ).toBe("none");
  });
});
