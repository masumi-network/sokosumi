import { expect, it } from "vitest";

import { monthPostCount, postsGoingOut } from "./strategy";

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

it("counts search ads as ads, not posts", () => {
  const month = [
    entry("a"),
    entry("b", { channel: "linkedin" }),
    entry("ad1", { channel: "google_ads", format: "search ad" }),
    entry("ad2", { channel: "google_ads", format: "search ad" }),
  ];
  expect(monthPostCount(month)).toBe(2);
});

it("counts a shared short video once on each network, and newsletter issues, like the month's total", () => {
  const calendar = [
    entry("x1"),
    entry("t1", {
      channel: "tiktok",
      format: "video",
      alsoOn: ["instagram", "youtube"],
    }),
    entry("n1", { channel: "newsletter", format: "issue" }),
    entry("skip", { status: "skipped" }),
  ];
  const made = new Set(["x1", "t1", "n1"]);
  expect(postsGoingOut(calendar, made)).toBe(5);
  expect(postsGoingOut(calendar, made)).toBe(monthPostCount(calendar));
});
