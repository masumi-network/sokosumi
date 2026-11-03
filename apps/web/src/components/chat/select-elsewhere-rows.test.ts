import { describe, expect, it } from "vitest";

import { selectElsewhereRows } from "./select-elsewhere-rows";

/**
 * `m` names the reader; `p` is a plain unread room; `x` is a Pinned room, which
 * lists under Pinned instead. Core's order, as given.
 */
function rooms(pattern: string) {
  return [...pattern].map((kind, index) => ({
    id: `${kind}${index}`,
    unreadMentionCount: kind === "m" ? 1 : 0,
    starredAt: kind === "x" ? new Date("2026-08-01T00:00:00.000Z") : null,
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
    ["a pinned room takes no row", "xpp", "p1 p2", 0],
    ["a pinned room takes no place in the five", "xppppp", "p1 p2 p3 p4 p5", 0],
    ["nor does it overflow", "pppppx", "p0 p1 p2 p3 p4", 0],
  ])("%s", (_name, pattern, expectedRows, overflowCount) => {
    expect(ids(pattern)).toEqual({ rows: expectedRows, overflowCount });
  });

  it("gives an open pinned room no row", () => {
    expect(ids("xp", "x0")).toEqual({ rows: "p1", overflowCount: 0 });
  });

  it("keeps the open room's row past the cap", () => {
    expect(ids("ppppppp", "p6")).toEqual({
      rows: "p0 p1 p2 p3 p4 p6",
      overflowCount: 1,
    });
  });
});
