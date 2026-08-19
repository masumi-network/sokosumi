import { describe, expect, it } from "vitest";

import {
  matchSokoBotEveTurnBoundary,
  shouldPersistSokoBotEveEvent,
} from "./eve-stream";

function event(type: string, data: Record<string, unknown>, index: number) {
  return {
    startIndex: index,
    event: {
      type,
      data,
      meta: { id: `event_${index}`, at: new Date(0).toISOString() },
    },
  };
}

describe("Soko Bot Eve stream projection", () => {
  it("binds only matching turn and user-message boundaries", () => {
    const started = event("turn.started", { turnId: "eve_turn_2" }, 20);
    const received = event(
      "message.received",
      { turnId: "eve_turn_2", message: "repeat this" },
      21,
    );

    expect(
      matchSokoBotEveTurnBoundary({
        turnStarted: started,
        messageReceived: received,
        expectedMessage: "repeat this",
        alreadyOwned: false,
      }),
    ).toBe("eve_turn_2");
    expect(
      matchSokoBotEveTurnBoundary({
        turnStarted: started,
        messageReceived: received,
        expectedMessage: "different message",
        alreadyOwned: false,
      }),
    ).toBeNull();
  });

  it("rejects a stale boundary even when owner repeated the same message", () => {
    expect(
      matchSokoBotEveTurnBoundary({
        turnStarted: event("turn.started", { turnId: "already_ingested" }, 10),
        messageReceived: event(
          "message.received",
          { turnId: "already_ingested", message: "same message" },
          11,
        ),
        expectedMessage: "same message",
        alreadyOwned: true,
      }),
    ).toBeNull();
  });

  it("drops token deltas while retaining durable lifecycle events", () => {
    expect(shouldPersistSokoBotEveEvent("message.appended")).toBe(false);
    expect(shouldPersistSokoBotEveEvent("reasoning.appended")).toBe(false);
    expect(shouldPersistSokoBotEveEvent("action.partial")).toBe(false);
    expect(shouldPersistSokoBotEveEvent("message.completed")).toBe(true);
    expect(shouldPersistSokoBotEveEvent("session.waiting")).toBe(true);
  });
});
