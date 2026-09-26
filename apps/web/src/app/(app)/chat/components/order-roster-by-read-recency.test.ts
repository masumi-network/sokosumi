import { describe, expect, it } from "vitest";

import type { RoomMemberReadState } from "@/app/chat/hooks/use-room-read-receipts";

import { orderRosterByReadRecency } from "./order-roster-by-read-recency";
import type { RoomParticipantPreview } from "./room-helpers";

function human(id: string): RoomParticipantPreview {
  return {
    kind: "human",
    id,
    name: id,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
  };
}

function coworker(id: string): RoomParticipantPreview {
  return {
    kind: "coworker",
    id,
    name: id,
    slug: id,
    caption: null,
    image: null,
    presence: "online",
  };
}

function readStateFrom(
  marks: Record<string, string | "unread">,
): (userId: string) => RoomMemberReadState | null {
  return (userId) => {
    const mark = marks[userId];
    if (mark == null) {
      return null;
    }
    return mark === "unread"
      ? { kind: "unread" }
      : { kind: "read", lastReadAt: new Date(mark) };
  };
}

function idsOf(participants: readonly RoomParticipantPreview[]) {
  return participants.map((participant) => participant.id);
}

describe("orderRosterByReadRecency", () => {
  it("puts the most recent reader first", () => {
    const ordered = orderRosterByReadRecency(
      [human("a"), human("b"), human("c")],
      {
        readStateFor: readStateFrom({
          a: "2026-01-01T10:00:00.000Z",
          b: "2026-01-01T12:00:00.000Z",
          c: "2026-01-01T11:00:00.000Z",
        }),
      },
    );

    expect(idsOf(ordered)).toEqual(["b", "c", "a"]);
  });

  it("sinks members who have not read below every reader", () => {
    const ordered = orderRosterByReadRecency(
      [human("unread"), human("reader")],
      {
        readStateFor: readStateFrom({
          unread: "unread",
          reader: "2026-01-01T10:00:00.000Z",
        }),
      },
    );

    expect(idsOf(ordered)).toEqual(["reader", "unread"]);
  });

  /**
   * The stack is the roster, so everyone stays on it. A Coworker simply has
   * no mark to sort by and keeps the roster's own order among the unmarked.
   */
  it("keeps machines and the unmarked on the roster, in the order given", () => {
    const ordered = orderRosterByReadRecency(
      [coworker("bot"), human("viewer"), human("reader")],
      { readStateFor: readStateFrom({ reader: "2026-01-01T10:00:00.000Z" }) },
    );

    expect(idsOf(ordered)).toEqual(["reader", "bot", "viewer"]);
  });

  it("leaves a guest's roster exactly as it arrived", () => {
    const roster = [human("a"), human("b"), coworker("bot")];

    const ordered = orderRosterByReadRecency(roster, {
      // What the hook reports to a guest: nothing, about anyone.
      readStateFor: () => null,
    });

    expect(idsOf(ordered)).toEqual(idsOf(roster));
  });

  it("does not mutate the roster it was handed", () => {
    const roster = [human("a"), human("b")];

    orderRosterByReadRecency(roster, {
      readStateFor: readStateFrom({ b: "2026-01-01T10:00:00.000Z" }),
    });

    expect(idsOf(roster)).toEqual(["a", "b"]);
  });
});
