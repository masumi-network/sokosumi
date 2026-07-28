import { describe, expect, it } from "vitest";
import {
  isCoworkerOnlyDirectRoom,
  shouldShowChatRoomThreadButton,
  shouldUseCoworkerRoomStream,
} from "../room-helpers";

const coworkerOnlyDirect = {
  kind: "direct",
  userMembers: [{ id: "user-1" }],
  coworkerMembers: [{ id: "coworker-1" }],
};

const humanChannel = {
  kind: "channel",
  userMembers: [{ id: "user-1" }, { id: "user-2" }],
  coworkerMembers: [],
};

const humanDirect = {
  kind: "direct",
  userMembers: [{ id: "user-1" }, { id: "user-2" }],
  coworkerMembers: [],
};

describe("isCoworkerOnlyDirectRoom", () => {
  it("returns true for direct with one coworker and one user", () => {
    expect(isCoworkerOnlyDirectRoom(coworkerOnlyDirect)).toBe(true);
  });

  it("returns false when userMembers is empty (align with Core === 1)", () => {
    expect(
      isCoworkerOnlyDirectRoom({
        kind: "direct",
        userMembers: [],
        coworkerMembers: [{ id: "coworker-1" }],
      }),
    ).toBe(false);
  });

  it("returns false for channels", () => {
    expect(isCoworkerOnlyDirectRoom(humanChannel)).toBe(false);
  });

  it("returns false for human-only directs", () => {
    expect(isCoworkerOnlyDirectRoom(humanDirect)).toBe(false);
  });

  it("returns false when more than one user on a coworker direct", () => {
    expect(
      isCoworkerOnlyDirectRoom({
        kind: "direct",
        userMembers: [{ id: "user-1" }, { id: "user-2" }],
        coworkerMembers: [{ id: "coworker-1" }],
      }),
    ).toBe(false);
  });

  it("returns false when coworker count is not exactly one", () => {
    expect(
      isCoworkerOnlyDirectRoom({
        kind: "direct",
        userMembers: [{ id: "user-1" }],
        coworkerMembers: [],
      }),
    ).toBe(false);
    expect(
      isCoworkerOnlyDirectRoom({
        kind: "direct",
        userMembers: [{ id: "user-1" }],
        coworkerMembers: [{ id: "c1" }, { id: "c2" }],
      }),
    ).toBe(false);
  });
});

describe("coworker DM cutover gating (rooms-client wiring)", () => {
  it("routes coworker-only direct composer to room stream (not message POST)", () => {
    expect(shouldUseCoworkerRoomStream(coworkerOnlyDirect)).toBe(true);
    expect(shouldUseCoworkerRoomStream(humanChannel)).toBe(false);
    expect(shouldUseCoworkerRoomStream(humanDirect)).toBe(false);
  });

  it("hides thread button on coworker-only directs (SOK-656 Option A)", () => {
    expect(
      shouldShowChatRoomThreadButton({
        room: coworkerOnlyDirect,
        isStreamOverlay: false,
      }),
    ).toBe(false);
  });

  it("hides thread button on stream overlays even for channels", () => {
    expect(
      shouldShowChatRoomThreadButton({
        room: humanChannel,
        isStreamOverlay: true,
      }),
    ).toBe(false);
  });

  it("shows thread button on channels and human directs when not overlay", () => {
    expect(
      shouldShowChatRoomThreadButton({
        room: humanChannel,
        isStreamOverlay: false,
      }),
    ).toBe(true);
    expect(
      shouldShowChatRoomThreadButton({
        room: humanDirect,
        isStreamOverlay: false,
      }),
    ).toBe(true);
  });
});
