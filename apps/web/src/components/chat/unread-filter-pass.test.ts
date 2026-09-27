import { describe, expect, it } from "vitest";

import {
  advanceUnreadFilterPass,
  EMPTY_UNREAD_FILTER_PASS,
} from "./unread-filter-pass";

function advance(steps: ReadonlyArray<string[]>) {
  return steps.reduce(
    (pass, unreadIds) => advanceUnreadFilterPass(pass, { unreadIds }),
    EMPTY_UNREAD_FILTER_PASS,
  );
}

describe("advanceUnreadFilterPass", () => {
  it("lists the first unread rooms in the order they came", () => {
    expect(advance([["launch", "design"]]).seen).toEqual(["launch", "design"]);
  });

  it("keeps a room in its place once it is read", () => {
    const pass = advance([["launch", "design", "ada"], ["launch", "ada"], []]);

    expect(pass.seen).toEqual(["launch", "design", "ada"]);
  });

  it("puts a room that turns unread later on top", () => {
    const pass = advance([
      ["launch", "design"],
      ["release", "design"],
    ]);

    expect(pass.seen).toEqual(["release", "launch", "design"]);
  });

  it("never lists a room that was not unread during the pass", () => {
    expect(advance([[], []]).seen).toEqual([]);
  });

  it("does not move a room that turns unread again", () => {
    const pass = advance([["launch", "design"], ["launch"], ["design"]]);

    expect(pass.seen).toEqual(["launch", "design"]);
  });

  it("answers with the same pass when nothing moved, so a render can compare", () => {
    const pass = advance([["launch"]]);

    expect(advanceUnreadFilterPass(pass, { unreadIds: ["launch"] })).toBe(pass);
  });
});
