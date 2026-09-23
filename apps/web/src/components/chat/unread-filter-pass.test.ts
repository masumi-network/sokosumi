import { describe, expect, it } from "vitest";

import {
  advanceUnreadFilterPass,
  EMPTY_UNREAD_FILTER_PASS,
} from "./unread-filter-pass";

function advance(
  steps: ReadonlyArray<{ unreadIds: string[]; activeRoomId?: string | null }>,
) {
  return steps.reduce(
    (pass, step) =>
      advanceUnreadFilterPass(pass, {
        unreadIds: step.unreadIds,
        activeRoomId: step.activeRoomId ?? null,
      }),
    EMPTY_UNREAD_FILTER_PASS,
  );
}

describe("advanceUnreadFilterPass", () => {
  it("starts with nothing just read", () => {
    expect(advance([{ unreadIds: ["launch", "design"] }]).justRead).toEqual([]);
  });

  it("keeps each room read during the pass, newest first", () => {
    const pass = advance([
      { unreadIds: ["launch", "design", "ada"] },
      { unreadIds: ["design", "ada"] },
      { unreadIds: ["ada"] },
      { unreadIds: [] },
    ]);

    expect(pass.justRead).toEqual(["ada", "design", "launch"]);
  });

  it("never lists a room that was not unread during the pass", () => {
    const pass = advance([{ unreadIds: [] }, { unreadIds: [] }]);

    expect(pass.justRead).toEqual([]);
  });

  it("waits until the reader leaves the open room", () => {
    const reading = advance([
      { unreadIds: ["launch"], activeRoomId: "launch" },
      { unreadIds: [], activeRoomId: "launch" },
    ]);
    expect(reading.justRead).toEqual([]);

    const left = advanceUnreadFilterPass(reading, {
      unreadIds: [],
      activeRoomId: null,
    });
    expect(left.justRead).toEqual(["launch"]);
  });

  it("takes a room back out when it turns unread again", () => {
    const pass = advance([
      { unreadIds: ["launch"] },
      { unreadIds: [] },
      { unreadIds: ["launch"] },
    ]);

    expect(pass.justRead).toEqual([]);
  });

  it("answers with the same pass when nothing moved, so a render can compare", () => {
    const pass = advance([{ unreadIds: ["launch"] }]);

    expect(
      advanceUnreadFilterPass(pass, {
        unreadIds: ["launch"],
        activeRoomId: null,
      }),
    ).toBe(pass);
  });
});
