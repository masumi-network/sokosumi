import { expect, it } from "vitest";

import {
  calendarDays,
  monthLabel,
  monthPostCount,
  postRate,
  postsGoingOut,
} from "./strategy";

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
  expect(monthLabel(month)).toBe("2 posts and 2 ads");
  expect(monthLabel(month.slice(0, 1))).toBe("1 post");
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

it("says how often from the calendar's own count", () => {
  expect(postRate(89, 28)).toBe("About 3 a day");
  expect(postRate(56, 28)).toBe("2 a day");
  expect(postRate(23, 28)).toBe("About 6 a week");
  expect(postRate(2, 28)).toBe("2 this month");
  expect(
    calendarDays([
      entry("a", { date: "2026-11-23" }),
      entry("b", { date: "2026-12-20" }),
    ]),
  ).toBe(28);
});
