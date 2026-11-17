import { expect, it } from "vitest";

import { pieceMade } from "./calendar";

const piece = (status: "idea" | "draft" | "scheduled", format: string) => ({
  status,
  channel: "linkedin",
  format,
});

it("counts a piece made once it is scheduled or out", () => {
  expect(pieceMade(piece("scheduled", "image"), false)).toBe(true);
  expect(
    pieceMade({ ...piece("idea", "post"), status: "published" }, false),
  ).toBe(true);
});

it("keeps a written piece in the making until its picture or video exists", () => {
  expect(pieceMade(piece("draft", "post"), false)).toBe(true);
  expect(pieceMade(piece("draft", "image"), false)).toBe(false);
  expect(pieceMade(piece("draft", "video"), true)).toBe(true);
});

it("never shows a topic as made", () => {
  expect(pieceMade(piece("idea", "post"), true)).toBe(false);
});
