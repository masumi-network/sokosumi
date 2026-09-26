import { describe, expect, it } from "vitest";

import {
  canQuoteIntoRoom,
  isSelfJoinableChannelDiscoverability,
} from "./chat-room-quote-audience.js";

describe("canQuoteIntoRoom", () => {
  it("allows a quote when every target reader is in the source room", () => {
    expect(canQuoteIntoRoom(["alice", "bob"], ["alice", "bob", "carol"])).toBe(
      true,
    );
  });

  it("allows identical rosters", () => {
    expect(canQuoteIntoRoom(["alice", "bob"], ["bob", "alice"])).toBe(true);
  });

  it("allows a Self Direct whose only reader is in the source room", () => {
    expect(canQuoteIntoRoom(["alice"], ["alice", "bob"])).toBe(true);
  });

  it("refuses when a target reader is not in the source room", () => {
    expect(canQuoteIntoRoom(["alice", "bob", "carol"], ["alice", "bob"])).toBe(
      false,
    );
  });

  it("refuses disjoint rosters", () => {
    expect(canQuoteIntoRoom(["alice"], ["bob"])).toBe(false);
  });

  it("refuses an empty source roster", () => {
    expect(canQuoteIntoRoom(["alice"], [])).toBe(false);
  });
});

describe("isSelfJoinableChannelDiscoverability", () => {
  it.each([
    ["public", true],
    ["external", true],
    ["private", false],
    ["matched", false],
    [null, false],
  ])("%s → %s", (discoverability, joinable) => {
    expect(isSelfJoinableChannelDiscoverability(discoverability)).toBe(
      joinable,
    );
  });
});
