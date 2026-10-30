import { describe, expect, it } from "vitest";

import { selectElsewhereRows } from "./select-elsewhere-rows";

/** `m` names the reader; `p` is a plain unread room. Core's order, as given. */
function rooms(pattern: string) {
  return [...pattern].map((kind, index) => ({
    id: `${kind}${index}`,
    unreadMentionCount: kind === "m" ? 1 : 0,
  }));
}

function ids(pattern: string, openRoomId: string | null = null) {
  const { rows, overflowCount } = selectElsewhereRows(
    rooms(pattern),
    openRoomId,
  );
  return { rows: rows.map((row) => row.id).join(" "), overflowCount };
}

describe("selectElsewhereRows", () => {
  it.each([
    ["nothing unread", "", "", 0],
    ["under the cap", "ppp", "p0 p1 p2", 0],
    ["exactly five", "ppppp", "p0 p1 p2 p3 p4", 0],
    ["one over: its own overflow row", "pppppp", "p0 p1 p2 p3 p4", 1],
    ["many over", "pppppppp", "p0 p1 p2 p3 p4", 3],
    ["mentions take their place first", "mmppppp", "m0 m1 p2 p3 p4", 2],
    ["every mention, past the cap", "mmmmmmm", "m0 m1 m2 m3 m4 m5 m6", 0],
    ["no plain room past the mentions", "mmmmmmpp", "m0 m1 m2 m3 m4 m5", 2],
  ])("%s", (_name, pattern, expectedRows, overflowCount) => {
    expect(ids(pattern)).toEqual({ rows: expectedRows, overflowCount });
  });

  it("keeps the open room's row past the cap", () => {
    expect(ids("ppppppp", "p6")).toEqual({
      rows: "p0 p1 p2 p3 p4 p6",
      overflowCount: 1,
    });
  });
});
