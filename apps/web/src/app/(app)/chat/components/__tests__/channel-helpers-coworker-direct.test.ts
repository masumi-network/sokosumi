import { describe, expect, it } from "vitest";
import { isCoworkerOnlyDirectRoom } from "../channel-helpers";

describe("isCoworkerOnlyDirectRoom", () => {
  it("returns true for direct with one coworker and one user", () => {
    expect(
      isCoworkerOnlyDirectRoom({
        kind: "direct",
        userMembers: [{ id: "user-1" }],
        coworkerMembers: [{ id: "coworker-1" }],
      }),
    ).toBe(true);
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
    expect(
      isCoworkerOnlyDirectRoom({
        kind: "channel",
        userMembers: [{ id: "user-1" }],
        coworkerMembers: [{ id: "coworker-1" }],
      }),
    ).toBe(false);
  });

  it("returns false for human-only directs", () => {
    expect(
      isCoworkerOnlyDirectRoom({
        kind: "direct",
        userMembers: [{ id: "user-1" }, { id: "user-2" }],
        coworkerMembers: [],
      }),
    ).toBe(false);
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
