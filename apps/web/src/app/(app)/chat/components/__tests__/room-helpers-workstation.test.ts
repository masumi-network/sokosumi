import { describe, expect, it } from "vitest";

import { shouldDisableCoworkerThreadComposer } from "../room-helpers";

function humanMessage() {
  return { sender: { type: "user" as const }, mentions: [] };
}

function coworkerMessage() {
  return { sender: { type: "coworker" as const }, mentions: [] };
}

function mentionedCoworkerMessage() {
  return {
    sender: { type: "user" as const },
    mentions: [{ coworkerId: "cow_1" }],
  };
}

describe("shouldDisableCoworkerThreadComposer", () => {
  it("keeps the composer when the member may use the workstation", () => {
    expect(
      shouldDisableCoworkerThreadComposer({
        canUseWorkstation: true,
        isCoworkerStreamRoom: true,
        threadMessages: [coworkerMessage()],
      }),
    ).toBe(false);
  });

  it("disables coworker 1:1 threads when the member has no workstation", () => {
    expect(
      shouldDisableCoworkerThreadComposer({
        canUseWorkstation: false,
        isCoworkerStreamRoom: true,
        threadMessages: [humanMessage()],
      }),
    ).toBe(true);
  });

  it("keeps human-only channel threads when the member has no workstation", () => {
    expect(
      shouldDisableCoworkerThreadComposer({
        canUseWorkstation: false,
        isCoworkerStreamRoom: false,
        threadMessages: [humanMessage(), humanMessage()],
      }),
    ).toBe(false);
  });

  it("disables a channel thread that already has a coworker sender", () => {
    expect(
      shouldDisableCoworkerThreadComposer({
        canUseWorkstation: false,
        isCoworkerStreamRoom: false,
        threadMessages: [humanMessage(), coworkerMessage()],
      }),
    ).toBe(true);
  });

  it("disables a channel thread that would auto-dispatch a coworker mention", () => {
    expect(
      shouldDisableCoworkerThreadComposer({
        canUseWorkstation: false,
        isCoworkerStreamRoom: false,
        threadMessages: [mentionedCoworkerMessage()],
      }),
    ).toBe(true);
  });
});
