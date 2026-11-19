import { expect, it } from "vitest";

import { monthPostCount } from "./strategy";

const entry = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    date: "2026-11-20",
    channel: "x",
    format: "post",
    title: id,
    status: "idea",
    ...extra,
  }) as Parameters<typeof monthPostCount>[0][number];

it("counts the same month the same before and after approval", () => {
  const video = entry("v1", {
    format: "talking_video",
    alsoOn: ["facebook", "instagram"],
  });
  const draft = [entry("a"), entry("b", { status: "skipped" }), video];
  const approved = [
    entry("a"),
    entry("b", { status: "skipped" }),
    video,
    entry("v1-facebook", { channel: "facebook", videoOf: "v1" }),
    entry("v1-instagram", { channel: "instagram", videoOf: "v1" }),
  ];
  expect(monthPostCount(draft)).toBe(4);
  expect(monthPostCount(approved)).toBe(4);
});
