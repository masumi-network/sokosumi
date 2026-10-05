import { describe, expect, it } from "vitest";

import { shouldAllowRoomSkills } from "./room-helpers";

const room = (kind: string, users: number, coworkers: number, bots = 0) => ({
  kind,
  userMembers: Array.from({ length: users }, (_, i) => ({ id: `u${i}` })),
  coworkerMembers: Array.from({ length: coworkers }, (_, i) => ({
    id: `c${i}`,
  })),
  sokoBotMembers: Array.from({ length: bots }, (_, i) => ({ id: `b${i}` })),
});

describe("shouldAllowRoomSkills", () => {
  it("hides skills without agents", () => {
    expect(shouldAllowRoomSkills(room("channel", 3, 0))).toBe(false);
    expect(shouldAllowRoomSkills(room("direct", 2, 0))).toBe(false);
  });
  it("keeps skills with an agent", () => {
    expect(shouldAllowRoomSkills(room("channel", 2, 1))).toBe(true);
    expect(shouldAllowRoomSkills(room("direct", 2, 0, 1))).toBe(true);
  });
  it("keeps skills off in the coworker 1:1 stream", () => {
    expect(shouldAllowRoomSkills(room("direct", 1, 1))).toBe(false);
  });
});
